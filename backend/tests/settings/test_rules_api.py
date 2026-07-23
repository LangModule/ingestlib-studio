"""Tests for the content-rules endpoints: read, save, validation caps, and
the delete-on-empty rule. Nothing here reaches the cloud."""
from fastapi.testclient import TestClient

from app import bootstrap
from app.main import create_app

_RULES = {
    "classify": {
        "rules": {"invoice": "Itemized charges", "sec_filing": "10-K style filings"},
        "target_pages": "1,3,5-7",
        "max_pages": 5,
    },
    "split": {
        "categories": {"financial_statements": "Balance sheets", "notes": ""},
        "unmatched": "skip",
    },
}


def test_rules_empty_and_editable_by_default(configured_client):
    body = configured_client.get("/api/settings/rules").json()
    assert body["editable"] is True
    assert body["rules"]["classify"]["rules"] == {}
    assert body["rules"]["split"]["categories"] == {}
    assert body["rules"]["split"]["unmatched"] == "other"


def test_rules_round_trip_writes_rules_yaml(configured_client):
    body = configured_client.put("/api/settings/rules", json=_RULES).json()
    assert body["rules"]["classify"]["rules"]["invoice"] == "Itemized charges"
    assert body["rules"]["split"]["unmatched"] == "skip"

    text = bootstrap.rules_path().read_text()
    assert "invoice: Itemized charges" in text
    assert "target_pages: 1,3,5-7" in text
    assert "unmatched: skip" in text

    again = configured_client.get("/api/settings/rules").json()
    assert again["rules"] == body["rules"], "a fresh read must match what was saved"


def test_default_unmatched_stays_unwritten(configured_client):
    rules = {"split": {"categories": {"a": "b"}, "unmatched": "other"}}
    configured_client.put("/api/settings/rules", json=rules)
    assert "unmatched" not in bootstrap.rules_path().read_text()


def test_clearing_every_rule_deletes_the_file(configured_client):
    configured_client.put("/api/settings/rules", json=_RULES)
    assert bootstrap.rules_path().is_file()
    configured_client.put("/api/settings/rules", json={})
    assert not bootstrap.rules_path().exists(), (
        "an absent rules.yaml is the honest open-ended state"
    )


def test_caps_and_grammar_are_422(configured_client):
    too_many_rules = {"classify": {"rules": {f"t{i}": "d" for i in range(21)}}}
    assert configured_client.put("/api/settings/rules", json=too_many_rules).status_code == 422

    too_many_cats = {"split": {"categories": {f"s{i}": "d" for i in range(51)}}}
    assert configured_client.put("/api/settings/rules", json=too_many_cats).status_code == 422

    bad_pages = {"classify": {"target_pages": "abc"}}
    assert configured_client.put("/api/settings/rules", json=bad_pages).status_code == 422

    # library-parity: parse_page_spec rejects 0 and reversed ranges too
    zero_page = {"classify": {"target_pages": "0"}}
    assert configured_client.put("/api/settings/rules", json=zero_page).status_code == 422
    reversed_range = {"classify": {"target_pages": "7-5"}}
    assert configured_client.put("/api/settings/rules", json=reversed_range).status_code == 422

    orphan_mode = {"split": {"categories": {}, "unmatched": "skip"}}
    assert configured_client.put("/api/settings/rules", json=orphan_mode).status_code == 422


def test_externally_managed_config_is_read_only(scratch, monkeypatch):
    external_dir = scratch / "elsewhere"
    external_dir.mkdir()
    (external_dir / "config.yaml").write_text(
        'aws:\n  profile: p\n  region: us-east-1\n  account_id: "1"\n'
    )
    (external_dir / "rules.yaml").write_text("classify:\n  rules:\n    memo: notes\n")
    monkeypatch.setenv(bootstrap.CONFIG_ENV_VAR, str(external_dir / "config.yaml"))

    client_ = TestClient(create_app())
    body = client_.get("/api/settings/rules").json()
    assert body["editable"] is False
    assert body["rules"]["classify"]["rules"] == {"memo": "notes"}, (
        "external rules display read-only"
    )
    assert client_.put("/api/settings/rules", json=_RULES).status_code == 409


def test_wizard_rerun_preserves_rules_yaml(configured_client):
    """Rules are user content — re-running setup must not destroy them."""
    configured_client.put("/api/settings/rules", json=_RULES)
    answers = {
        "aws": {"profile": "p2", "region": "us-east-1", "account_id": "1"},
        "bucket": "b", "vector_store": "sqlite", "reranker": "none", "secrets": {},
    }
    assert configured_client.post("/api/setup/complete", json=answers).json()["configured"]
    assert bootstrap.rules_path().is_file(), "wizard completion must leave rules.yaml alone"
