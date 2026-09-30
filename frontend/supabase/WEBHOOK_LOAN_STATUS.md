# Loan Application — Webhook se data (CHFPL -> GRD)

Ab Loan Application page (aur Dealer Portal ka Loan Status) CHFPL ko live call nahi karta.
CHFPL har change par GRD ko webhook bhejta hai, GRD use `chfpl_loan_cache` table me rakhta hai, page wahin se padhta hai.

## URL
POST  https://<GRD-DOMAIN>/api/loan-status-webhook

Header:
  x-grd-bridge-secret: <CHFPL_GRD_BRIDGE_SECRET>     (GRD ke .env wala hi secret)
  Content-Type: application/json

## Body (recommended: poori application)
{
  "application": {
    "id": 123,                       // CHFPL loan id (zaroori)
    "application_no": "APP-0001",
    "status": "fi_pending",
    "tvr_status": "",
    "customer_name": "...", "customer_phone": "...",
    "dealer_name": "...", "dealer_code": "K-03", "grd_dealer_id": 5,
    "vehicle_model_name": "...", "loan_vehicle_type": "...",
    "loan_amount_requested": 100000, "tenure_months": 24,
    "loan_account_no": "", "submitted_at": "2026-09-29T10:00:00Z",
    "fe_user_id": null, "do_user_id": null, "lifecycle_status": ""
  }
}
Ek saath kai bhejne ho to:  { "applications": [ {...}, {...} ] }

## Sirf status badalna ho (purana format bhi chalta hai)
{ "chfpl_loan_id": 123, "status": "approved", "tvr_status": "verified", "grd_submission_ref": 45 }
Partial update purana data nahi mitata, sirf bheje hue fields badalte hain.

## Delete
{ "event": "deleted", "chfpl_loan_id": 123 }

## Purana data
Cache khali ho to page pehli baar khulne par ek baar bridge (CHFPL_API_URL) se purana data import kar leta hai.
Agar bridge band ho to CHFPL se ek baar `{"applications":[...saari purani...]}` bhej do.
