# Development boundary

This Terraform root is intentionally inert. It contains no Google provider and
no resources, so `plan` and `apply` cannot create a development Cloud SQL,
Cloud Run service, network, or optional module.

The active development environment remains the existing Sites/Workers/D1/R2
deployment with one authorized user and test data. Brett's reported company
Google Cloud project candidate is only for the current Workspace test connector
after its read-only inventory and exact follow-up changes are owner-approved.

Do not copy staging or production state, credentials, OAuth clients, secrets, or
data into this boundary. Do not add the future employee-login client here.
