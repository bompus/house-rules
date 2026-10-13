import importlib.util
import subprocess
import sys
import json
import os
import signal
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location(
    "check_landing", SOURCE / "check-landing.py"
)
check_landing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_landing)


def git(path, *args):
    return subprocess.run(
        ["git", "-c", "user.email=test@example.com",
         "-c", "user.name=test", *args],
        cwd=path,
        capture_output=True,
        text=True,
        timeout=60,
    )


class CheckLandingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.assertEqual(git(self.repo, "init", "-b", "main").returncode, 0)
        (self.repo / "a.txt").write_text("one\n")
        git(self.repo, "add", ".")
        self.assertEqual(git(self.repo, "commit", "-m", "base").returncode, 0)
        # Fake a remote-tracking base ref without network.
        base = git(self.repo, "rev-parse", "HEAD").stdout.strip()
        self.assertEqual(
            git(self.repo, "update-ref", "refs/remotes/origin/main", base).returncode,
            0,
        )

    def state(self, path=None, base="origin/main"):
        return check_landing.landing_state(path or str(self.repo), base)

    def test_ancestor_branch_is_landed_and_clean(self):
        r = self.state()
        self.assertTrue(r["clean"])
        self.assertTrue(r["ancestor"])
        self.assertTrue(r["content_landed"])
        self.assertTrue(r["ok"])

    def test_squash_landed_branch_is_landed_but_not_ancestor(self):
        git(self.repo, "checkout", "-b", "feature", "--quiet")
        (self.repo / "b.txt").write_text("two\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "work", "--quiet")
        # Simulate a squash merge: same content, new commit on main.
        git(self.repo, "checkout", "main", "--quiet")
        git(self.repo, "merge", "--squash", "feature", "--quiet")
        git(self.repo, "commit", "-m", "squash", "--quiet")
        git(self.repo, "update-ref", "refs/remotes/origin/main", "main")
        git(self.repo, "checkout", "feature", "--quiet")
        r = self.state()
        self.assertFalse(r["ancestor"])
        self.assertTrue(r["content_landed"])
        self.assertTrue(r["ok"])

    def test_unique_commit_is_unlanded(self):
        git(self.repo, "checkout", "-b", "feature", "--quiet")
        (self.repo / "b.txt").write_text("two\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "work", "--quiet")
        r = self.state()
        self.assertFalse(r["content_landed"])
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "unlanded content vs base")

    def test_dirty_tree_is_not_ok(self):
        (self.repo / "a.txt").write_text("changed\n")
        r = self.state()
        self.assertFalse(r["clean"])
        self.assertFalse(r["ok"])

    def test_missing_base_ref(self):
        r = self.state(base="origin/nope")
        self.assertFalse(r["ok"])
        self.assertIn("base ref missing", r["reason"])

    def test_base_drift_is_indeterminate(self):
        git(self.repo, "checkout", "-b", "feature", "--quiet")
        (self.repo / "b.txt").write_text("two\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "work", "--quiet")
        git(self.repo, "checkout", "main", "--quiet")
        git(self.repo, "merge", "--squash", "feature", "--quiet")
        git(self.repo, "commit", "-m", "squash", "--quiet")
        # Base advances the same file differently afterwards.
        (self.repo / "b.txt").write_text("two-plus\n")
        git(self.repo, "commit", "-am", "advance", "--quiet")
        git(self.repo, "update-ref", "refs/remotes/origin/main", "main")
        git(self.repo, "checkout", "feature", "--quiet")
        r = self.state()
        self.assertFalse(r["content_landed"])
        self.assertTrue(r.get("indeterminate"))
        self.assertFalse(r["ok"])
        self.assertIn("indeterminate", r["reason"])

    @unittest.skipUnless(Path("/proc/self").is_dir(), "needs /proc")
    def test_lists_process_running_in_checkout(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; from pathlib import Path; "
                                  "Path('/proc/self/comm').write_bytes(b'fixture-\\xff\\n'); "
                                  "print('ready', flush=True); time.sleep(30)",
                                  "diagnostic-secret-fixture"], cwd=self.repo,
                                 start_new_session=True, stdout=subprocess.PIPE)
        self.addCleanup(child.wait)
        self.addCleanup(child.kill)
        self.assertEqual(child.stdout.readline(), b"ready\n")
        self.addCleanup(child.stdout.close)
        procs = self.state()["processes"]
        self.assertEqual([p["pid"] for p in procs], [child.pid])
        self.assertNotIn("diagnostic-secret-fixture", json.dumps(procs))
        self.assertEqual(set(procs[0]), {"pid", "own_session", "comm"})
        self.assertEqual(procs[0]["comm"], "fixture-\ufffd")

    def spawn_agent(self, body):
        """A python child whose comm is `claude`; body runs inside it."""
        script = ("import subprocess, sys, time\nfrom pathlib import Path\n"
                  "Path('/proc/self/comm').write_bytes(b'claude\\n')\n" + body)
        agent = subprocess.Popen([sys.executable, "-c", script, str(self.repo),
                                  str(SOURCE / "check-landing.py")],
                                 stdout=subprocess.PIPE, text=True)
        self.addCleanup(agent.wait)
        self.addCleanup(agent.kill)
        self.addCleanup(agent.stdout.close)
        return agent

    CHILD = ("child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],"
             " cwd=sys.argv[1], start_new_session=True)\n")
    CHECK = ("out = subprocess.run([sys.executable, sys.argv[2], '--path', sys.argv[1]],"
             " capture_output=True, text=True).stdout\n")

    @unittest.skipUnless(Path("/proc/self").is_dir(), "needs /proc")
    def test_descendant_of_agent_ancestor_is_own_session(self):
        agent = self.spawn_agent(self.CHILD + "time.sleep(0.5)\n" + self.CHECK
                                 + "child.kill()\nprint(out)\n")
        report = json.loads(agent.stdout.read())
        procs = report["processes"]
        self.assertEqual(len(procs), 1)
        self.assertTrue(procs[0]["own_session"])

    @unittest.skipUnless(Path("/proc/self").is_dir(), "needs /proc")
    def test_process_under_sibling_agent_is_not_own_session(self):
        # Both agents share this test process as their parent, like sessions
        # under one agent host's server.
        sibling = self.spawn_agent(self.CHILD + "print(child.pid, flush=True)\ntime.sleep(30)\n")
        sibling_child = int(sibling.stdout.readline())
        self.addCleanup(os.kill, sibling_child, signal.SIGKILL)
        mine = self.spawn_agent(self.CHECK + "print(out)\n")
        procs = json.loads(mine.stdout.read())["processes"]
        self.assertEqual([p["pid"] for p in procs], [sibling_child])
        self.assertFalse(procs[0]["own_session"])

    def test_nearest_agent_matches_comm_names_and_none_without_one(self):
        comms = {10: "python3", 20: "opencode.exe", 30: "claude", 40: "node-MainThread"}
        self.assertEqual(check_landing.nearest_agent([10, 20, 30], comms.get), 20)
        self.assertEqual(check_landing.nearest_agent([10, 40], comms.get), None)
        self.assertEqual(check_landing.nearest_agent([], comms.get), None)

    def test_fail_on_unlanded_flag(self):
        self.assertEqual(
            check_landing.main(["--path", str(self.repo)]), 0
        )
        git(self.repo, "checkout", "-b", "feature", "--quiet")
        (self.repo / "b.txt").write_text("two\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "work", "--quiet")
        self.assertEqual(
            check_landing.main(
                ["--path", str(self.repo), "--fail-on-unlanded"]
            ),
            1,
        )

    def test_default_base_follows_origin_head(self):
        self.assertEqual(check_landing.default_base(str(self.repo)),
                         "origin/main")
        # A fork whose default branch is not main: origin/main lags behind
        # and would report landed work as unlanded.
        git(self.repo, "checkout", "-b", "fork/dev", "--quiet")
        (self.repo / "b.txt").write_text("two\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "fork work", "--quiet")
        git(self.repo, "update-ref", "refs/remotes/origin/fork/dev", "HEAD")
        git(self.repo, "symbolic-ref", "refs/remotes/origin/HEAD",
            "refs/remotes/origin/fork/dev")
        self.assertEqual(check_landing.default_base(str(self.repo)),
                         "origin/fork/dev")
        self.assertEqual(
            check_landing.main(
                ["--path", str(self.repo), "--fail-on-unlanded"]
            ),
            0,
        )
        self.assertEqual(
            check_landing.main(["--path", str(self.repo), "--base",
                                "origin/main", "--fail-on-unlanded"]),
            1,
        )


if __name__ == "__main__":
    unittest.main()
