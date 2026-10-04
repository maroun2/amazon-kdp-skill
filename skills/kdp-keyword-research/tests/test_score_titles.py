#!/usr/bin/env python3
import json
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
import score_titles  # noqa: E402


FIXTURE = Path(__file__).parent / "fixtures" / "keywords.json"
MARKDOWN_FIXTURE = Path(__file__).parent / "fixtures" / "keywords.md"


class TitleScoringTests(unittest.TestCase):
    def test_inflections_normalize(self):
        self.assertEqual(score_titles.normalize_word("learning"), "learn")
        self.assertEqual(score_titles.normalize_word("learns"), "learn")
        self.assertEqual(score_titles.normalize_word("flying"), "fly")
        self.assertEqual(score_titles.normalize_word("flight"), "fly")
        self.assertEqual(score_titles.normalize_word("tried"), "try")
        self.assertEqual(score_titles.normalize_word("trying"), "try")

    def test_fillers_are_removed_but_who_fly_again_remain(self):
        self.assertEqual(score_titles.meaningful_title_words("The who and fly to again"), ["who", "fly", "again"])

    def test_possessives_and_contractions(self):
        self.assertEqual(score_titles.words("Children’s can't"), ["children", "can't"])

    def test_zero_matches(self):
        result = score_titles.score_title("Unlisted moon", ["learn to fly"])
        self.assertEqual(result["raw_score"], 0)
        self.assertEqual(result["meaningful_word_count"], 2)
        self.assertEqual(result["normalized_score"], 0.0)

    def test_fixture_json_and_score(self):
        rows = score_titles.read_keyword_rows(FIXTURE)
        result = score_titles.score_title("Learning flight", rows)
        self.assertEqual(result["raw_score"], 7)
        self.assertEqual(result["meaningful_word_count"], 2)
        self.assertEqual(result["normalized_score"], 3.5)

    def test_fixture_markdown_rows(self):
        self.assertEqual(score_titles.read_keyword_rows(MARKDOWN_FIXTURE), ["learn to fly", "who can fly"])

    def test_ties_and_descending_sort(self):
        results = score_titles.score_titles(["Who", "Again", "Try"], ["who can fly", "again", "try flying"])
        self.assertEqual([item["title"] for item in results], ["Again", "Try", "Who"])
        self.assertEqual(results[0]["normalized_score"], 1.0)


if __name__ == "__main__":
    unittest.main()
