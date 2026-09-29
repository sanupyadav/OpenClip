import hinglish


def _transcript():
    return {"language": "hi", "segments": [{
        "start": 0.0, "end": 2.0, "text": "आज का माइनक्राफ्ट दिन",
        "words": [{"word": " आज", "start": 0.0, "end": 0.4}, {"word": " का", "start": 0.4, "end": 0.6},
                  {"word": " माइनक्राफ्ट", "start": 0.6, "end": 1.4}, {"word": " दिन", "start": 1.4, "end": 2.0}]}]}


def test_model_romanizes_every_word_and_keeps_the_timings():
    seen = {}

    def ask(prompt, schema):
        seen["prompt"] = prompt
        return {"words": ["aaj", "ka", "Minecraft", "din"]}
    t = hinglish.romanize_transcript(_transcript(), ask)
    seg = t["segments"][0]
    assert seg["text"] == "aaj ka Minecraft din" and t["script"] == "latin"
    assert [w["word"] for w in seg["words"]] == [" aaj", " ka", " Minecraft", " din"]
    assert [w["start"] for w in seg["words"]] == [0.0, 0.4, 0.6, 1.4]
    assert "exactly 4 items" in seen["prompt"]
    assert not hinglish.wanted(t)  # never twice


def test_a_bad_model_answer_falls_back_to_rules_and_leaves_no_devanagari():
    t = hinglish.romanize_transcript(_transcript(), lambda p, s: {"words": ["only one"]})
    text = t["segments"][0]["text"]
    assert not hinglish.DEVANAGARI.search(text) and text.startswith("aaj ka")
    t = hinglish.romanize_transcript(_transcript(), None)  # no model at all
    assert not hinglish.DEVANAGARI.search(t["segments"][0]["text"])


def test_rule_romanize_basics():
    assert hinglish.rule_romanize("आज") == "aaj"
    assert hinglish.rule_romanize("है") == "hai"
    assert hinglish.rule_romanize("नहीं।") == "naheen."
    assert hinglish.rule_romanize("२०२६") == "2026"
    assert hinglish.rule_romanize("का") == "ka" and hinglish.rule_romanize("मेरी") == "meri"
    assert hinglish.rule_romanize("बात") == "baat"


def test_prompt_language_and_switch(monkeypatch):
    t = hinglish.romanize_transcript(_transcript(), None)
    assert "Roman" in hinglish.prompt_language(t) and "never Devanagari" in hinglish.prompt_language(t)
    assert hinglish.prompt_language({"language": "en"}) == "en"
    monkeypatch.setenv("HINGLISH", "0")
    assert not hinglish.wanted(_transcript())
    monkeypatch.setenv("HINGLISH", "1")
    assert hinglish.wanted(_transcript()) and not hinglish.wanted({"language": "en", "segments": []})
