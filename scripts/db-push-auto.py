#!/usr/bin/env python3
"""
Runs `drizzle-kit push --force` inside a pseudo-tty and auto-answers
interactive prompts with their safe defaults.

Why this exists: drizzle-kit's --force flag still prompts when adding a
constraint to a non-empty table or when it detects a possible schema rename.
The default choices preserve rows: do not truncate a table, and create the
declared new schema object rather than renaming an unrelated existing one.
Piped/non-TTY stdin does NOT satisfy these prompts (it just hangs until
killed), because the prompt library reads raw keypresses that require an
actual pty. This wrapper allocates one so CI/post-merge automation can get
through it non-interactively.

Usage: python3 scripts/db-push-auto.py <path-to-drizzle-package-dir>
Example: python3 scripts/db-push-auto.py lib/db
"""
import os
import pty
import select
import sys
import time

TIMEOUT_SECONDS = 170
PROMPT_MARKERS = (
    b"Do you want to truncate",
    b"created or renamed from another",
)
DEBOUNCE_SECONDS = 0.4


def main():
    if len(sys.argv) < 2:
        print("usage: db-push-auto.py <drizzle-package-dir>", file=sys.stderr)
        sys.exit(2)

    workdir = sys.argv[1]
    cmd = ["npx", "drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"]

    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.chdir(workdir)
        os.setsid()
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.execvp(cmd[0], cmd)
        os._exit(127)  # execvp failed

    os.close(slave)
    buf = b""
    start = time.time()
    prompt_seen_at = None

    while True:
        if time.time() - start > TIMEOUT_SECONDS:
            print("\ndb-push-auto: TIMEOUT waiting for drizzle-kit push", file=sys.stderr)
            os.kill(pid, 9)
            sys.exit(1)

        ready, _, _ = select.select([master], [], [], 0.3)
        if master in ready:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if not data:
                break
            buf += data
            sys.stdout.buffer.write(data)
            sys.stdout.flush()

        if any(marker in buf for marker in PROMPT_MARKERS):
            if prompt_seen_at is None:
                prompt_seen_at = time.time()
            elif time.time() - prompt_seen_at > DEBOUNCE_SECONDS:
                # Selects the default highlighted option: do not truncate
                # existing rows, and create the declared schema object.
                os.write(master, b"\r")
                buf = b""
                prompt_seen_at = None
        else:
            prompt_seen_at = None

        done_pid, status = os.waitpid(pid, os.WNOHANG)
        if done_pid != 0:
            try:
                while True:
                    data = os.read(master, 4096)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
            except OSError:
                pass
            exit_code = os.waitstatus_to_exitcode(status)
            sys.exit(exit_code)


if __name__ == "__main__":
    main()
