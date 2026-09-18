-- GRD Dealer Registered/Unregistered + Customer Invoice + Cashfree Payment
ALTER TABLE dealer ADD COLUMN IF NOT EXISTS registration_type VARCHAR(20) DEFAULT 'registered';
CREATE INDEX IF NOT EXISTS idx_dealer_registration_type ON dealer(registration_type);
UPDATE dealer SET registration_type='registered' WHERE registration_type IS NULL OR trim(registration_type)='';

CREATE TABLE IF NOT EXISTS dealer_payment (
  id SERIAL PRIMARY KEY,
  dealer_id INTEGER NOT NULL REFERENCES dealer(id),
  order_id VARCHAR(80) UNIQUE NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  allocation_type VARCHAR(20) DEFAULT 'on_account',
  allocation_json TEXT,
  status VARCHAR(20) DEFAULT 'created',
  cf_payment_id VARCHAR(80),
  payment_method VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dealer_payment_dealer ON dealer_payment(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_payment_status ON dealer_payment(status);
