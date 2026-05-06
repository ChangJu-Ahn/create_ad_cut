"""Unit tests for prompt assembly + style headers."""

from __future__ import annotations

import pytest

from app.prompts.style_headers import STYLE_HEADERS, header_for


def test_all_four_modes_present() -> None:
    assert set(STYLE_HEADERS) == {"lookbook", "front", "side", "back"}


@pytest.mark.parametrize("mode", ["lookbook", "front", "side", "back"])
def test_each_header_is_korean_and_mentions_size(mode: str) -> None:
    header = header_for(mode)  # type: ignore[arg-type]
    assert "1024x1024" in header
    # Sanity: Korean characters present
    assert any("\uac00" <= ch <= "\ud7a3" for ch in header)


def test_unknown_mode_raises_keyerror() -> None:
    with pytest.raises(KeyError):
        header_for("flatlay")  # type: ignore[arg-type]
