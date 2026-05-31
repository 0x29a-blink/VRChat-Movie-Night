from app.search.parse import _parse_language_meta, parse_stream


def test_dub_from_release_name():
    meta = _parse_language_meta("Show.Name.S01E01.1080p.English.Dub.x265")
    assert meta["audio_lang"] == "dub"
    assert "Dub" in meta["lang_tags"]


def test_dual_audio():
    meta = _parse_language_meta("Anime Movie 1080p Dual Audio AAC")
    assert meta["audio_lang"] == "dual"
    assert "Dual" in meta["lang_tags"]


def test_sub_japanese():
    meta = _parse_language_meta("Anime 720p JPN AAC Subbed")
    assert meta["audio_lang"] == "sub"
    assert "Sub" in meta["lang_tags"]


def test_hardsub_tag():
    meta = _parse_language_meta("Title 1080p Hardsub HEVC")
    assert meta["subtitle_type"] == "hardsub"
    assert "Hardsub" in meta["lang_tags"]


def test_parse_stream_includes_lang_fields():
    row = parse_stream(
        {
            "url": "magnet:?xt=urn:btih:" + "a" * 40,
            "name": "Test 1080p Dub",
            "behaviorHints": {"filename": "Test.1080p.Dual.Audio.mkv"},
        }
    )
    assert row is not None
    assert row["audio_lang"] == "dual"
    assert "Dual" in row["lang_tags"]


def test_aiostreams_parsed_file_languages():
    row = parse_stream(
        {
            "url": "magnet:?xt=urn:btih:" + "b" * 40,
            "name": "Addon 1080p",
            "description": "line\n🌎 English | Japanese\n📝 English\n",
            "streamData": {
                "parsedFile": {
                    "languages": ["English", "Japanese"],
                    "subtitles": ["English"],
                    "resolution": "1080p",
                    "quality": "BluRay",
                    "encode": "HEVC",
                    "audioTags": ["TrueHD"],
                    "visualTags": ["DV"],
                    "audioChannels": ["7.1"],
                    "releaseGroup": "GROUP",
                },
                "size": 62_500_000_000,
                "torrent": {"seeders": 125},
                "service": {"id": "realdebrid", "cached": True},
            },
            "behaviorHints": {},
        }
    )
    assert row is not None
    assert row["languages"] == ["English", "Japanese"]
    assert row["subtitle_langs"] == ["English"]
    assert row["audio_lang"] in ("dual", "dub")
    assert row["resolution"] == "1080p"
    assert row["codec"] == "HEVC"
    assert row["source"] == "BluRay"
    assert row["seeders"] == 125
    assert row["cached"] is True
    assert row["release_group"] == "GROUP"
