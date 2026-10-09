"""Organisation accounts, isolated workspaces and sourced event ingestion."""
from alembic import op

revision = "002"
down_revision = "001"

# Frozen DDL: future ORM changes must not silently rewrite this migration.
SCHEMA = """
CREATE TABLE accounts (
	id VARCHAR(36) NOT NULL, 
	username VARCHAR(60) NOT NULL, 
	display_name VARCHAR(80) NOT NULL, 
	password_hash VARCHAR(250) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (username)
);
CREATE TABLE auth_throttle (
	key VARCHAR(64) NOT NULL, 
	attempts INTEGER NOT NULL, 
	reset_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (key)
);
CREATE TABLE organisations (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);
CREATE TABLE import_batches (
	id VARCHAR(36) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	actor VARCHAR(80) NOT NULL, 
	filename VARCHAR(100) NOT NULL, 
	imported_count INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id)
);
CREATE INDEX ix_import_batches_organisation_id ON import_batches (organisation_id);
CREATE TABLE integrations (
	id VARCHAR(36) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	origins JSON NOT NULL, 
	key_hash VARCHAR(64) NOT NULL, 
	key_prefix VARCHAR(20) NOT NULL, 
	active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	last_used_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	UNIQUE (key_hash)
);
CREATE INDEX ix_integrations_organisation_id ON integrations (organisation_id);
CREATE TABLE invitations (
	id VARCHAR(36) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	revoked BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	UNIQUE (token_hash)
);
CREATE INDEX ix_invitations_organisation_id ON invitations (organisation_id);
CREATE TABLE memberships (
	organisation_id VARCHAR(36) NOT NULL, 
	account_id VARCHAR(36) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	active BOOLEAN NOT NULL, 
	PRIMARY KEY (organisation_id, account_id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	FOREIGN KEY(account_id) REFERENCES accounts (id)
);
CREATE TABLE workspace_audit (
	id SERIAL NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	case_id VARCHAR(36), 
	actor VARCHAR(80) NOT NULL, 
	action VARCHAR(40) NOT NULL, 
	details JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id)
);
CREATE INDEX ix_workspace_audit_case_id ON workspace_audit (case_id);
CREATE INDEX ix_workspace_audit_organisation_id ON workspace_audit (organisation_id);
CREATE TABLE workspace_cases (
	id VARCHAR(36) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	external_id VARCHAR(64) NOT NULL, 
	payload JSON NOT NULL, 
	revision INTEGER NOT NULL, 
	evidence_revision INTEGER NOT NULL, 
	review_status VARCHAR(30) NOT NULL, 
	assigned_to VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_workspace_external_id UNIQUE (organisation_id, external_id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	FOREIGN KEY(assigned_to) REFERENCES accounts (id)
);
CREATE INDEX ix_workspace_cases_organisation_id ON workspace_cases (organisation_id);
CREATE TABLE workspace_sessions (
	token_hash VARCHAR(64) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	account_id VARCHAR(36) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (token_hash), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	FOREIGN KEY(account_id) REFERENCES accounts (id)
);
CREATE TABLE collection_tickets (
	token_hash VARCHAR(64) NOT NULL, 
	integration_id VARCHAR(36) NOT NULL, 
	case_id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	browser_token VARCHAR(100) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (token_hash), 
	FOREIGN KEY(integration_id) REFERENCES integrations (id), 
	FOREIGN KEY(case_id) REFERENCES workspace_cases (id)
);
CREATE TABLE evidence_events (
	id VARCHAR(36) NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	case_id VARCHAR(36) NOT NULL, 
	external_id VARCHAR(160) NOT NULL, 
	source VARCHAR(30) NOT NULL, 
	payload JSON NOT NULL, 
	received_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_workspace_event UNIQUE (organisation_id, external_id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	FOREIGN KEY(case_id) REFERENCES workspace_cases (id)
);
CREATE INDEX ix_evidence_events_case_id ON evidence_events (case_id);
CREATE INDEX ix_evidence_events_organisation_id ON evidence_events (organisation_id);
CREATE TABLE workspace_assessments (
	id SERIAL NOT NULL, 
	organisation_id VARCHAR(36) NOT NULL, 
	case_id VARCHAR(36) NOT NULL, 
	policy_version VARCHAR(30) NOT NULL, 
	evidence_revision INTEGER NOT NULL, 
	payload JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id), 
	FOREIGN KEY(case_id) REFERENCES workspace_cases (id)
);
CREATE INDEX ix_workspace_assessments_case_id ON workspace_assessments (case_id);
CREATE INDEX ix_workspace_assessments_organisation_id ON workspace_assessments (organisation_id);
"""


def upgrade():
    for statement in SCHEMA.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade():
    raise RuntimeError("Restore a verified backup instead of deleting organisation records.")
