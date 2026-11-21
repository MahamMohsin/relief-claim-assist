-- Policy change: allow unlimited claims per household.
-- Rewrites section A1 so the assistant and RAG no longer refuse second claims.
update public.policy_sections
set content = 'Synthetic households in an affected demo area may apply. There is no limit on claims — a household may file as many claims as it needs, and each claim is reviewed independently by an officer.',
    keywords = array['eligible','eligibility','qualify','apply','household','claim','claims','multiple','unlimited','again','second','اہلیت','درخواست']
where section_code = 'A1';
