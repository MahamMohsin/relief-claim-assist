# Relief Claim Assist Manual Workflow Test

Use this guide to test a new claim from submission to officer approval, simulated payment, and receipt verification. Use synthetic data throughout.

## Before you start

- Open the [verified local preview](http://localhost:3001/). If it has stopped, run `npm.cmd run build` and then `npm.cmd run start -- --hostname 127.0.0.1 --port 3001` from the project folder.
- Confirm the banner says **PROTOTYPE · SIMULATED DPI DATA** and the status says **Online**. If someone is already signed in, click the persona name in the top bar to switch.
- The main test uses the built-in **Readable sample**. For the file upload path, use the [synthetic income certificate](../tests/fixtures/synthetic-income.png). The [synthetic English audio clip](../tests/fixtures/synthetic-english.wav) is available for transcription testing.

## Claim to verified payment

| Step | What to do | Expected result |
| --- | --- | --- |
| 1. Save a draft | Choose **Fatima Bibi**. Open **Relief Claim → New claim**. Enter `14500` for monthly household income and `3` for people in household. Enter a unique label in **Additional details**, such as `Manual demo 01`. Click **Save draft**. | The app says **Draft saved**. |
| 2. Attach and submit | Click **Continue to evidence**. Leave **Mock identity card** and **Readable sample** selected. Click **Attach evidence** and wait for confirmation. Click **Review claim → Submit claim**. Copy the full claim ID from the claim details. | The evidence shows **Readable**. The claim shows **Submitted** and has a rule version. |
| 3. Approve | Switch to **Officer Bilal → Review Desk**. Select Fatima’s case and match the claim ID. Choose **Approve** under **Officer action**. Enter `Reviewed the synthetic household details and readable evidence.` under **Plain-language reason**. Click **Record decision**. | The claim shows **Approved** and payment remains **Pending**. |
| 4. Issue payment | On the same case, click **Issue simulated payment**. Copy the receipt reference beginning with `SIM-`. | Payment changes to **Paid** and the simulated receipt displays a reference and amount. |
| 5. Confirm as the citizen | Switch back to **Fatima Bibi → Relief Claim**. Expand the claim with the same ID. | The claim shows the officer’s reason and a paid receipt with the same reference and amount. |
| 6. Verify as the shopkeeper | Switch to **Tariq Karyana Store → Scam Shield**. Enter the new `SIM-` reference and the message `Raast credited my simulated relief payment.` Click **Check message**. | The simulated payment rail shows **Paid** with the same reference and amount. |

The workflow passes when the same claim reaches **Paid** and both the citizen and shopkeeper see the matching receipt.

## Additional checks

| Scenario | Action | Expected result |
| --- | --- | --- |
| Blurry evidence | Start a separate claim as Fatima. Save the draft, attach **Blurry sample**, and submit. | The claim shows **Needs proof**. Review Desk requires the citizen to resubmit proof before approval. |
| Network loss | In a new claim, turn on **Simulate network drop** before saving. Queue the draft, attach the readable sample, and click **Queue claim**. Turn the toggle off and let sync finish. Use **Sync now** if items remain queued. | The queued count clears. The new claim appears once and includes the attached evidence. |
| Consent revocation | As Fatima, open **My Privacy** and note Zainab’s existing access. Revoke it. Switch to **Zainab Health Worker → Family Switch** and try to open Fatima’s record. Restore the previous access after the check. | The server denies access to Fatima’s family. **Auditor Kamran → Audit Vault** shows the revocation and denied access. |
| Policy lookup by voice | As Fatima, set the voice dock to **EN**. Tap the mic and say “What is the relief policy for widows?” Tap again to stop, check the transcript, then click **Send command**. | The assistant opens **Policy Ask** and cites **A3 · Widow and urgent cases** in its reply. |
| Private image upload | As Fatima, save a new draft. Choose **Mock income slip** and upload the [synthetic income certificate](../tests/fixtures/synthetic-income.png). Attach it and submit. As Bilal, select the same claim in **Review Desk** and click **Open synthetic image**. | Review Desk displays the evidence metadata and opens the private image. With MiMo available, the evidence includes document analysis. |

The voice dock also accepts typed commands. Jev uses simulated routing with the current configuration, and playback depends on the browser’s available voices.

## Record the result

| Field | Value |
| --- | --- |
| Test date and browser | |
| Claim ID | |
| Receipt reference and amount | |
| Steps passed | |
| Failed step and exact message | |

If the claim is hard to find in **Review Desk**, scroll the queue and compare IDs. Cases with lower confidence can appear ahead of the new claim. If submission times out, reopen **Relief Claim** and check whether the claim already exists before starting another.

## Rerun the automated checks

Run the commands below from the project folder. The browser tests use Chrome by default. The suite creates synthetic claims and audit events in the configured Supabase project and restores the prior rule configuration and Fatima’s helper access.

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```
