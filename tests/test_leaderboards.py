"""Per-category leaderboard aggregation over run records."""

from chessbench.leaderboards import category_leaderboard


def _run(model, slug, items):
    return {"schema": "chessbench.run.v1", "kind": "puzzle", "model": model,
            "condition": {"slug": slug}, "items": items}


def _item(rating, solved, tier, motifs):
    return {"rating": rating, "solved": solved, "score": 1.0 if solved else 0.0,
            "categories": {"tier": [tier], "motif": motifs}}


def test_category_leaderboard_ranks_within_categories():
    strong = _run("strong", "m2", [_item(1500, True, "intermediate", ["fork"]) for _ in range(5)])
    weak = _run("weak", "m2", [_item(1500, i < 1, "intermediate", ["fork"]) for i in range(5)])
    board = category_leaderboard([strong, weak], min_n=3)

    assert "tier:intermediate" in board and "motif:fork" in board
    fork = board["motif:fork"]
    assert [r.model for r in fork][0].startswith("strong")     # stronger ranks first
    assert fork[0].points > fork[1].points


def test_min_n_filters_thin_categories():
    r = _run("m", "m2", [_item(1500, True, "expert", ["pin"])])  # only 1 item
    board = category_leaderboard([r], min_n=3)
    assert "motif:pin" not in board            # below min_n -> excluded


def test_dim_restriction():
    r = _run("m", "m2", [_item(1500, True, "novice", ["skewer"]) for _ in range(3)])
    board = category_leaderboard([r], min_n=3, dim="tier")
    assert all(k.startswith("tier:") for k in board)
