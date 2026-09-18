-- GRD Supabase migration: DO number + billing workflow + staff mobile + loan documents
alter table if exists "user" add column if not exists mobile varchar(30);
alter table if exists loan_workflow add column if not exists do_no varchar(50);
alter table if exists loan_workflow add column if not exists customer_photo text;
alter table if exists loan_workflow add column if not exists customer_documents text;
alter table if exists tax_invoice add column if not exists do_no varchar(50);
alter table if exists tax_invoice add column if not exists billing_remarks varchar(500);

create unique index if not exists uq_loan_workflow_do_no on loan_workflow(do_no) where do_no is not null;
create index if not exists ix_tax_invoice_do_no on tax_invoice(do_no);
