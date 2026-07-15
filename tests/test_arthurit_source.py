from __future__ import annotations

from chessbench.sources.arthurit import iter_arthurit_pgn, parse_stipulation


def test_stipulation_parser_orders_series_before_ordinary_help():
    assert parse_stipulation("Ser-h#3") == ("series_helpmate", 3)
    assert parse_stipulation("s#2") == ("selfmate", 2)
    assert parse_stipulation("Problem #4") == ("directmate", 4)


def test_pgn_export_reader_preserves_headers(tmp_path):
    path = tmp_path / "arthurit.pgn"
    path.write_text(
        '[Event "Newspaper problem"]\n'
        '[Stipulation "s#1"]\n'
        '[SetUp "1"]\n'
        '[FEN "8/1Q6/8/4R3/3p4/8/1q6/5k1K w - - 0 1"]\n'
        '[ProblemId "42"]\n'
        '[Result "*"]\n\n*\n',
        encoding="utf-8",
    )
    records = list(iter_arthurit_pgn(path))
    assert len(records) == 1
    assert records[0].id == "arthurit-42"
    assert records[0].kind == "selfmate"
    assert records[0].headers["Event"] == "Newspaper problem"
