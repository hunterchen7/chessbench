"""Per-attempt game durability and exact private-conversation resumption."""

from __future__ import annotations

import json
from dataclasses import asdict, replace

import chess
import pytest

from chessbench.agents import LLMGameAgent
from chessbench.conditions import Legality, mode_condition
from chessbench.database import BenchmarkStore, RunSpec
from chessbench.models.base import ScriptedModel
from chessbench.tasks.games import (
    GameConfig,
    GameRecord,
    MoveAttempt,
    MoveRecord,
    play_game,
)
from chessbench.tasks.tournament import TournamentEntry, round_robin
from chessbench.variants import ModelVariant


class Interrupted(RuntimeError):
    pass


def _spec(condition=None) -> RunSpec:
    return RunSpec(
        "tournament",
        ModelVariant("resume", "Resume", "openrouter", "test/resume"),
        condition or mode_condition(2),
        1,
        suite_name="resume",
        suite_hash="resume-v1",
        suite_visibility="private",
    )


def _model(
    name: str,
    moves: list[str],
    secret_prefix: str,
    calls: list[list[dict[str, str]]],
) -> ScriptedModel:
    remaining = iter(moves)

    def respond(messages):
        calls.append([dict(message) for message in messages])
        return json.dumps(
            {"move": next(remaining), "rationale": f"{secret_prefix}-{len(calls)}"}
        )

    return ScriptedModel(respond, name=name)


def test_midgame_resume_only_calls_remaining_turns_and_restores_private_chats(tmp_path):
    condition = mode_condition(2)
    db = tmp_path / "resume.db"
    first_white_calls: list[list[dict[str, str]]] = []
    first_black_calls: list[list[dict[str, str]]] = []
    white = LLMGameAgent(
        _model("white", ["e2e4", "g1f3"], "WHITE-PRIVATE", first_white_calls),
        condition,
    )
    black = LLMGameAgent(
        _model("black", ["e7e5"], "BLACK-PRIVATE", first_black_calls),
        condition,
    )

    with BenchmarkStore(db) as store:
        run = store.start_run(_spec())
        store.start_game(run.run_id, 0, "white", "black", None)

        def interrupt_after_three(board, records):
            store.save_game_progress(run.run_id, 0, "white", "black", None, records)
            if sum(record.uci is not None for record in records) == 3:
                raise Interrupted

        try:
            play_game(
                white,
                black,
                condition,
                GameConfig(max_plies=6),
                on_move=interrupt_after_three,
            )
        except Interrupted:
            pass
        else:  # pragma: no cover - defensive
            raise AssertionError("game should have been interrupted")

        running = store.load_in_progress_games(run.run_id)[0]
        prefix = [asdict(record) for record in running.records]
        assert running.moves_san == ["e4", "e5", "Nf3"]
        assert len(first_white_calls) == 2 and len(first_black_calls) == 1

        resumed_white_calls: list[list[dict[str, str]]] = []
        resumed_black_calls: list[list[dict[str, str]]] = []
        resumed_white = LLMGameAgent(
            _model("white", ["f1b5"], "WHITE-RESUME", resumed_white_calls),
            condition,
        )
        resumed_black = LLMGameAgent(
            _model("black", ["b8c6", "a7a6"], "BLACK-RESUME", resumed_black_calls),
            condition,
        )

        def checkpoint_remaining(_white, _black, _fen, _sequence, board, records):
            store.save_game_progress(run.run_id, 0, "white", "black", None, records)

        resumed_tournament = round_robin(
            [
                TournamentEntry("white", resumed_white),
                TournamentEntry("black", resumed_black),
            ],
            1,
            condition,
            GameConfig(max_plies=6),
            in_progress_games={0: running},
            on_move=checkpoint_remaining,
            on_game=lambda record, sequence: store.save_game_result(
                run.run_id, sequence, record
            ),
        )
        completed = resumed_tournament.games[0]
        assert completed.moves_san == ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]
        assert [asdict(record) for record in completed.records[:3]] == prefix
        assert len(resumed_white_calls) == 1 and len(resumed_black_calls) == 2

        for call in resumed_white_calls:
            text = json.dumps(call)
            assert "WHITE-PRIVATE" in text
            assert "BLACK-PRIVATE" not in text and "BLACK-RESUME" not in text
        for call in resumed_black_calls:
            text = json.dumps(call)
            assert "BLACK-PRIVATE" in text
            assert "WHITE-PRIVATE" not in text and "WHITE-RESUME" not in text

        assert not store.save_game_result(run.run_id, 0, completed)
        durable = store.load_game_results(run.run_id)[0]
        assert durable == completed

        def forbidden(_messages):  # pragma: no cover - must never be called
            raise AssertionError("completed game was replayed")

        rerun = round_robin(
            [
                TournamentEntry(
                    "white",
                    LLMGameAgent(ScriptedModel(forbidden, name="white"), condition),
                ),
                TournamentEntry(
                    "black",
                    LLMGameAgent(ScriptedModel(forbidden, name="black"), condition),
                ),
            ],
            1,
            condition,
            GameConfig(max_plies=6),
            completed_games={0: durable},
        )
        assert rerun.games == [durable]


def test_forfeit_checkpoint_resumes_without_another_call(tmp_path):
    condition = mode_condition(1)
    calls: list[list[dict[str, str]]] = []
    white = LLMGameAgent(
        ScriptedModel(
            lambda messages: (
                calls.append([dict(message) for message in messages]) or "banana"
            ),
            name="white",
        ),
        condition,
    )
    black = LLMGameAgent(
        ScriptedModel(lambda _messages: "e7e5", name="black"), condition
    )
    with BenchmarkStore(tmp_path / "forfeit.db") as store:
        run = store.start_run(_spec())
        store.start_game(run.run_id, 0, "white", "black", None)

        def checkpoint(board, records):
            store.save_game_progress(run.run_id, 0, "white", "black", None, records)

        result = play_game(white, black, condition, on_move=checkpoint)
        assert result.termination == "illegal_forfeit" and len(calls) == 1
        running = store.load_in_progress_games(run.run_id)[0]
        assert running.records[-1].forfeited
        assert running.records[-1].attempts[0].raw_response == "banana"

        forbidden = LLMGameAgent(
            ScriptedModel(
                lambda _messages: (_ for _ in ()).throw(
                    AssertionError("forfeit was replayed")
                ),
                name="white",
            ),
            condition,
        )
        resumed = play_game(forbidden, black, condition, resume=running)
        assert resumed.termination == "illegal_forfeit"
        assert resumed.records == running.records


def test_retry_turn_resumes_after_paid_illegal_attempt_with_feedback_and_no_double_charge(
    tmp_path,
):
    condition = replace(mode_condition(2), legality=Legality.RETRY, retry_attempts=2)

    class UsageScripted(ScriptedModel):
        def __init__(self, reply, *, name, usage, cost):
            super().__init__(reply, name=name)
            self._usage = usage
            self._cost = cost
            self.last_usage = None
            self.last_cost = 0.0

        def chat(self, messages, *, temperature=0.0, max_tokens=2048):
            self.last_usage = self._usage
            self.last_cost = self._cost
            return super().chat(
                messages, temperature=temperature, max_tokens=max_tokens
            )

    first_calls = 0

    def first_illegal(_messages):
        nonlocal first_calls
        first_calls += 1
        return "banana"

    first_model = UsageScripted(
        first_illegal,
        name="white",
        usage={
            "prompt_tokens": 5,
            "completion_tokens": 2,
            "completion_tokens_details": {"reasoning_tokens": 1},
        },
        cost=0.01,
    )
    db = tmp_path / "retry.db"
    with BenchmarkStore(db) as store:
        run = store.start_run(_spec(condition))
        store.start_game(run.run_id, 0, "white", "black", None)

        def interrupt_on_illegal(board, records):
            store.save_game_progress(run.run_id, 0, "white", "black", None, records)
            if records[-1].uci is None:
                raise Interrupted

        try:
            play_game(
                LLMGameAgent(first_model, condition),
                LLMGameAgent(
                    ScriptedModel(lambda _messages: "e7e5", name="black"),
                    condition,
                ),
                condition,
                GameConfig(max_plies=1),
                on_move=interrupt_on_illegal,
            )
        except Interrupted:
            pass
        else:  # pragma: no cover - defensive
            raise AssertionError("illegal attempt should interrupt")

        running = store.load_in_progress_games(run.run_id)[0]
        assert first_calls == 1
        assert len(running.records) == 1
        assert running.records[0].illegal_attempts == 1
        assert len(running.records[0].attempts) == 1

        resumed_calls: list[list[dict[str, str]]] = []

        def legal(messages):
            resumed_calls.append([dict(message) for message in messages])
            return '{"move":"e2e4","rationale":"Center control."}'

        resumed_model = UsageScripted(
            legal,
            name="white",
            usage={
                "prompt_tokens": 7,
                "completion_tokens": 3,
                "completion_tokens_details": {"reasoning_tokens": 2},
            },
            cost=0.02,
        )

        def checkpoint_legal(board, records):
            store.save_game_progress(run.run_id, 0, "white", "black", None, records)

        completed = play_game(
            LLMGameAgent(resumed_model, condition),
            LLMGameAgent(
                ScriptedModel(lambda _messages: "e7e5", name="black"),
                condition,
            ),
            condition,
            GameConfig(max_plies=1),
            resume=running,
            on_move=checkpoint_legal,
        )
        assert len(resumed_calls) == 1
        assert "That move was illegal" in resumed_calls[0][-1]["content"]
        assert len(completed.records) == 1
        assert completed.records[0].uci == "e2e4"
        assert len(completed.records[0].attempts) == 2

        # The accepted response is already durable before game completion.
        accepted = store.load_in_progress_games(run.run_id)[0]
        assert accepted.records[0] == completed.records[0]
        assert store.run_row(run.run_id)["prompt_tokens"] == 0

        assert store.save_game_result(run.run_id, 0, completed)
        assert not store.save_game_result(run.run_id, 0, completed)
        row = store.run_row(run.run_id)
        assert row["prompt_tokens"] == 12
        assert row["completion_tokens"] == 5
        assert row["reasoning_tokens"] == 3
        assert row["cost_usd"] == pytest.approx(0.03)


def test_otb_cumulative_illegal_count_is_restored_across_turns():
    condition = replace(mode_condition(1), legality=Legality.OTB, otb_illegal_limit=2)
    prior_white_attempts = [
        MoveAttempt(None, "w illegal", "banana", None, False),
        MoveAttempt(None, "w legal", "e2e4", "e2e4", True),
    ]
    prior = GameRecord(
        "white",
        "black",
        "",
        "running",
        2,
        ["e4", "e5"],
        [
            MoveRecord(
                1,
                "white",
                "e4",
                "e2e4",
                False,
                1,
                attempts=prior_white_attempts,
            ),
            MoveRecord(
                2,
                "black",
                "e5",
                "e7e5",
                True,
                0,
                attempts=[MoveAttempt(None, "b legal", "e7e5", "e7e5", True)],
            ),
        ],
    )
    calls = 0

    def illegal(_messages):
        nonlocal calls
        calls += 1
        return "still-banana"

    result = play_game(
        LLMGameAgent(ScriptedModel(illegal, name="white"), condition),
        LLMGameAgent(
            ScriptedModel(
                lambda _messages: (_ for _ in ()).throw(
                    AssertionError("black should not move")
                ),
                name="black",
            ),
            condition,
        ),
        condition,
        resume=prior,
    )
    assert calls == 1
    assert result.termination == "illegal_forfeit"
    assert result.records[-1].color == "white"
    assert result.records[-1].illegal_attempts == 1


def test_resume_replays_board_stack_for_repetition_without_model_calls():
    board = chess.Board()
    records: list[MoveRecord] = []
    for uci in [
        "g1f3",
        "g8f6",
        "f3g1",
        "f6g8",
        "g1f3",
        "g8f6",
        "f3g1",
        "f6g8",
    ]:
        move = chess.Move.from_uci(uci)
        color = "white" if board.turn == chess.WHITE else "black"
        san = board.san(move)
        board.push(move)
        records.append(
            MoveRecord(
                board.ply(),
                color,
                san,
                uci,
                True,
                0,
                attempts=[MoveAttempt(None, f"{color} prompt", uci, uci, True)],
            )
        )
    prior = GameRecord(
        "white",
        "black",
        "",
        "running",
        8,
        [record.san for record in records if record.san],
        records,
    )

    def forbidden(_messages):  # pragma: no cover - no move is needed
        raise AssertionError("repetition state was not reconstructed")

    condition = mode_condition(2)
    result = play_game(
        LLMGameAgent(ScriptedModel(forbidden, name="white"), condition),
        LLMGameAgent(ScriptedModel(forbidden, name="black"), condition),
        condition,
        resume=prior,
    )
    assert result.termination == "repetition"
    assert result.result == "1/2-1/2"
    assert result.records == records


def test_resume_preserves_halfmove_clock_for_fifty_move_claim():
    start_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 99 1"
    move = MoveRecord(
        1,
        "white",
        "Nf3",
        "g1f3",
        True,
        0,
        attempts=[MoveAttempt(None, "white prompt", "g1f3", "g1f3", True)],
    )
    prior = GameRecord(
        "white",
        "black",
        "",
        "running",
        1,
        ["Nf3"],
        [move],
        start_fen=start_fen,
    )

    def forbidden(_messages):  # pragma: no cover - no move is needed
        raise AssertionError("halfmove clock was not reconstructed")

    condition = mode_condition(2)
    result = play_game(
        LLMGameAgent(ScriptedModel(forbidden, name="white"), condition),
        LLMGameAgent(ScriptedModel(forbidden, name="black"), condition),
        condition,
        start_fen=start_fen,
        resume=prior,
    )
    assert result.termination == "fifty_moves"
    assert result.result == "1/2-1/2"
