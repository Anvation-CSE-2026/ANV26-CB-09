"""Organisation-scoped evidence follow-up tasks."""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"


def upgrade():
    op.create_table("evidence_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organisation_id", sa.String(36), sa.ForeignKey("organisations.id"), nullable=False),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("workspace_cases.id"), nullable=False),
        sa.Column("requested_by", sa.String(36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("assigned_to", sa.String(36), sa.ForeignKey("accounts.id")),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("resolution", sa.String(1000), nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_evidence_requests_organisation_id", "evidence_requests", ["organisation_id"])
    op.create_index("ix_evidence_requests_case_id", "evidence_requests", ["case_id"])


def downgrade():
    raise RuntimeError("Evidence requests must not be deleted by a downgrade.")
