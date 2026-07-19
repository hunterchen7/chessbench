from chessbench.rated_sessions import (
    DEFAULT_RATED_MAX_PUZZLES,
    DEFAULT_RATED_MIN_PUZZLES,
    DEFAULT_RATED_SEED,
    DEFAULT_RATED_TARGET_DEVIATION,
    DEFAULT_RATED_TARGET_RADIUS,
    DeterministicPuzzleSelector,
    GlickoState,
    RatedSessionConfig,
    rating_summary,
    session_protocol,
    update_solver_rating,
)
from chessbench.tasks.puzzles import Puzzle


def _puzzle(identifier: str, rating: int, deviation: int = 80) -> Puzzle:
    return Puzzle(
        identifier,
        "6k1/8/8/8/8/8/8/6K1 w - - 0 1",
        ["g1f2", "g8f7"],
        rating,
        rating_deviation=deviation,
    )


def test_first_glicko_result_is_finite_symmetric_and_high_uncertainty():
    start = GlickoState()
    win = update_solver_rating(
        start, puzzle_rating=1500, puzzle_deviation=80, solved=True
    )
    loss = update_solver_rating(
        start, puzzle_rating=1500, puzzle_deviation=80, solved=False
    )

    assert round(win.rating, 6) == round(3000 - loss.rating, 6)
    assert round(win.deviation, 6) == round(loss.deviation, 6)
    assert win.rating > start.rating > loss.rating
    assert 75 < win.deviation < start.deviation
    assert win.provisional


def test_provisional_source_puzzle_downweights_solver_update():
    start = GlickoState()
    calibrated = update_solver_rating(
        start, puzzle_rating=1500, puzzle_deviation=80, solved=True
    )
    provisional = update_solver_rating(
        start, puzzle_rating=1500, puzzle_deviation=140, solved=True
    )

    assert start.rating < provisional.rating < calibrated.rating
    assert provisional.deviation > calibrated.deviation


def test_selector_is_deterministic_near_rating_and_without_replacement():
    puzzles = [_puzzle(f"p{rating}", rating) for rating in range(1200, 1801, 25)]
    config = RatedSessionConfig(seed=42, target_radius=100)
    first = DeterministicPuzzleSelector(puzzles, pool_hash="sha256:pool", config=config)
    second = DeterministicPuzzleSelector(puzzles, pool_hash="sha256:pool", config=config)
    state = GlickoState(rating=1512, deviation=200, volatility=0.09)
    used: list[str] = []

    path_a = []
    path_b = []
    for sequence in range(8):
        puzzle_a, selection_a = first.select(state, sequence=sequence, excluded=used)
        puzzle_b, selection_b = second.select(state, sequence=sequence, excluded=used)
        assert puzzle_a.id == puzzle_b.id
        assert selection_a == selection_b
        assert 1412 <= puzzle_a.rating <= 1612
        path_a.append(puzzle_a.id)
        path_b.append(puzzle_b.id)
        used.append(puzzle_a.id)

    assert path_a == path_b
    assert len(set(path_a)) == len(path_a)


def test_stopping_requires_minimum_and_target_rd_or_uses_cap():
    defaults = RatedSessionConfig()
    assert defaults.seed == DEFAULT_RATED_SEED == 0
    assert defaults.target_radius == DEFAULT_RATED_TARGET_RADIUS == 100
    assert defaults.min_puzzles == DEFAULT_RATED_MIN_PUZZLES == 50
    assert defaults.max_puzzles == DEFAULT_RATED_MAX_PUZZLES == 100
    assert defaults.target_deviation == DEFAULT_RATED_TARGET_DEVIATION == 77
    protocol = session_protocol(
        pool_name="rated-test",
        pool_version="1.0.0",
        pool_hash="sha256:test",
        config=defaults,
    )
    assert protocol["stopping"] == {
        "minimum_puzzles": 50,
        "maximum_puzzles": 100,
        "target_rating_deviation": 77,
    }

    config = RatedSessionConfig(min_puzzles=50, max_puzzles=100, target_deviation=75)
    settled = GlickoState(rating=1600, deviation=74.9, volatility=0.09)
    uncertain = GlickoState(rating=1600, deviation=75.1, volatility=0.09)

    assert not config.settled(settled, 49)
    assert config.settled(settled, 50)
    assert not config.settled(uncertain, 100)
    summary = rating_summary(settled, attempts=50, config=config)
    assert summary["settled"] is True
    assert summary["method"] == "lichess_glicko2_frozen_puzzles_v1"
    assert summary["ci95"] == [1450.2, 1749.8]
