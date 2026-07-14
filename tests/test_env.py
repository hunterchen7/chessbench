import os

from chessbench.env import load_local_env


def test_load_local_env_does_not_override_process_values(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("A=from-file\n# ignored\nB='two words'\n")
    monkeypatch.setenv("A", "already-set")
    monkeypatch.delenv("B", raising=False)
    load_local_env(path)
    assert os.environ["A"] == "already-set"
    assert os.environ["B"] == "two words"
