-- Supply relief.demo_password_hash, relief.gateway_hash and relief.partner_hash in this transaction.

insert into relief_private.server_credentials(name,secret_hash)
values('gateway',current_setting('relief.gateway_hash'))
on conflict (name) do update set secret_hash=excluded.secret_hash;

insert into public.api_keys(name,key_hash,scopes) values('Relief demo partner',current_setting('relief.partner_hash'),array['scheme:read'])
on conflict (key_hash) do nothing;

create temporary table relief_demo_people (id uuid, persona text, full_name text, role text) on commit drop;
insert into relief_demo_people values
('00000000-0000-4000-a000-000000000001','fatima','Fatima Bibi','citizen'),
('00000000-0000-4000-a000-000000000002','zainab','Zainab Health Worker','helper'),
('00000000-0000-4000-a000-000000000003','tariq','Tariq Karyana Store','shopkeeper'),
('00000000-0000-4000-a000-000000000004','bilal','Officer Bilal','officer'),
('00000000-0000-4000-a000-000000000005','sana','Admin Sana','admin'),
('00000000-0000-4000-a000-000000000006','kamran','Auditor Kamran','auditor');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',persona||'@relief-demo.example',
  current_setting('relief.demo_password_hash'), now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'relief_role',role),
  jsonb_build_object('full_name',full_name,'locale',case when persona='fatima' then 'ur' else 'en' end),
  now(),now(),'','','',''
from relief_demo_people
on conflict (id) do update set encrypted_password=excluded.encrypted_password,updated_at=now();

insert into auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
select gen_random_uuid(),id::text,id,jsonb_build_object('sub',id,'email',persona||'@relief-demo.example','email_verified',true),
  'email',now(),now(),now() from relief_demo_people
on conflict (provider_id,provider) do nothing;

insert into public.profiles(id,email,full_name,role,locale)
select id,persona||'@relief-demo.example',full_name,role,case when persona='fatima' then 'ur' else 'en' end from relief_demo_people
on conflict (id) do nothing;

insert into public.citizens(id,owner_id,cnic_mock,full_name,name_phonetic,household_size,monthly_income_mock,phone,village_area)
select ('10000000-0000-4000-a000-'||lpad(i::text,12,'0'))::uuid,
  case when i=1 then '00000000-0000-4000-a000-000000000001'::uuid end,
  case when i in (4,5,6) then 'MOCK-004' else 'MOCK-'||lpad(i::text,3,'0') end,
  case i when 1 then 'Fatima Bibi' when 2 then 'Ayesha Rani' when 3 then 'Nusrat Begum'
    when 4 then 'Muhammad Ali' when 5 then 'Mohammad Ali' when 6 then 'Muhammed Ali' else 'Synthetic Family '||lpad(i::text,2,'0') end,
  case when i in (4,5,6) then 'muhamad-ali' else 'fixture-'||i end,
  2 + (i % 5),14000 + (i*500),
  case when i in (4,5,6) then 'MOCK-PHONE-004' else 'MOCK-PHONE-'||lpad(i::text,3,'0') end,
  (array['Darya Colony','Mehrabad','Nawab Kot','Safa Village'])[(i % 4)+1]
from generate_series(1,40) i on conflict(id) do nothing;

insert into public.consents(citizen_id,grantee_user_id,status,granted_at)
select id,'00000000-0000-4000-a000-000000000002','granted',now() from public.citizens
where id::text like '10000000-0000-4000-a000-%' and right(id::text,2)<>'40'
on conflict(citizen_id,grantee_user_id,scope) do nothing;

insert into public.eligibility_rules(version,name,config_json,is_active)
values(1,'Emergency Cash Assistance','{"income_cap":30000,"minimum_household":2,"amount_pkr":25000,"confidence_threshold":0.9}',true)
on conflict(version) do nothing;

insert into public.policy_sections(policy_version,section_code,title,effective_date,content,keywords) values
('2026.1','A1','Who can apply','2026-01-01','Synthetic households in an affected demo area may apply. There is no limit on claims — a household may file as many claims as it needs, and each claim is reviewed independently by an officer.',
  array['eligible','eligibility','qualify','apply','household','claim','claims','multiple','unlimited','again','second','اہلیت','درخواست']),
('2026.1','A2','Household income cap','2026-01-01','Use the current scheme income cap and minimum household size shown in the registry. Compare the complete monthly household income in PKR against that cap.',
  array['income','earnings','salary','cap','آمدنی','تنخواہ']),
('2026.1','A3','Widow and urgent cases','2026-01-01','Widowed applicants can ask an officer to prioritize a hardship review. The same eligibility and evidence rules still apply.',
  array['widow','widowed','priority','urgent','بیوہ']),
('2026.1','A4','Proof and documents','2026-01-01','Submit a clearly readable synthetic mock identity card and income evidence. Officers may request replacement evidence for blurry or incomplete documents.',
  array['proof','document','documents','evidence','cnic','ثبوت','شناخت']),
('2026.1','A5','Payments and receipts','2026-01-01','An authorized officer approves the claim before a separate simulated Raast disbursement. The claim timeline shows payment status and the receipt reference.',
  array['payment','payout','receipt','raast','ادائیگی']),
('2026.1','A6','Disputes and missing funds','2026-01-01','Keep your mock claim ID. Use Scam Shield to report a missing simulated payment. An officer checks the rail receipt and reviews the dispute.',
  array['missing','dispute','appeal','report','شکایت']),
('2026.1','A7','Helper consent and correction','2026-01-01','Citizens may grant or revoke a helper’s access at any time under My Privacy. A data correction request records the field and proposed replacement for review.',
  array['consent','privacy','revoke','correction','helper','رضامندی']),
('2026.1','A8','Fraud and scam safety','2026-01-01','The fictional scheme never asks for a fee, OTP, password, or QR code to release aid. Verify payment claims in Scam Shield.',
  array['fraud','scam','otp','fee','password','دھوکہ'])
on conflict(policy_version,section_code) do nothing;

insert into public.claims(id,citizen_id,submitted_by,status,payment_status,amount_pkr,payload_json,citizen_reason_en,rule_version_used,ai_confidence,ai_route,handoff_notes)
select ('20000000-0000-4000-a000-'||lpad(i::text,12,'0'))::uuid,
  ('10000000-0000-4000-a000-'||lpad(i::text,12,'0'))::uuid,
  case when i=1 then '00000000-0000-4000-a000-000000000001'::uuid else '00000000-0000-4000-a000-000000000002'::uuid end,
  (array['approved','needs_proof','in_review','in_review','submitted'])[i],
  case when i=1 then 'paid' else 'pending' end,25000,
  jsonb_build_object('monthly_income',14000+i*500,'household_size',2+i%5,'notes','Synthetic judging fixture'),
  (array['Verified and paid on the simulated Raast rail.','Please replace the blurry mock ID.','Possible alteration in mock income slip.','Similar identity entries need an officer check.','One supporting field is missing.'])[i],
  1,(array[0.97,0.35,0.45,0.5,0.6])[i],'officer_review',
  (array['Clean eligible case','Blurry mock identity','Possible edited amount','Conflicting mock identity and phone','Incomplete supporting data'])[i]
from generate_series(1,5) i on conflict(id) do nothing;

insert into public.claim_documents(id,claim_id,doc_type,ocr_json,blur_score,tamper_flag,tamper_reason,verified_status)
select ('30000000-0000-4000-a000-'||lpad(i::text,12,'0'))::uuid,
  ('20000000-0000-4000-a000-'||lpad(i::text,12,'0'))::uuid,
  case when i=3 then 'income' else 'identity' end,
  jsonb_build_object('summary','Synthetic labeled evidence','fields',jsonb_build_object('mock_id','MOCK-00'||i)),
  case when i=2 then 0.97 else 0.05 end,i=3,case when i=3 then 'Edited amount in the fixture' end,
  (array['readable','unreadable','suspect','readable','incomplete'])[i]
from generate_series(1,5) i on conflict(id) do nothing;

insert into public.mock_payments(claim_id,raast_ref,amount_pkr,status,disbursed_at)
values('20000000-0000-4000-a000-000000000001','SIM-FATIMA1',25000,'paid',now())
on conflict(claim_id) do nothing;
select relief_private.audit(null,'system','demo_seed','workspace',null,'synthetic_fixtures_loaded',1);
