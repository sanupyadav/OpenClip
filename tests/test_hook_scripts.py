import hooks


class _Font:
    pass


def test_runs_split_between_the_typeface_and_the_script_fallback():
    main, alt = _Font(), _Font()
    main._script_fallback = (alt, frozenset(map(ord, "Minecraft 5!")))
    runs = hooks._script_runs("Minecraft में 5!", main)
    assert [(f is alt, t) for f, t in runs] == [(False, "Minecraft "), (True, "में"), (False, " 5!")]


def test_without_a_fallback_the_text_stays_one_run():
    f = _Font()
    assert hooks._script_runs("anything", f) == [(f, "anything")]
