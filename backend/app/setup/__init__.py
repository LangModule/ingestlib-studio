"""Setup wizard logic: verification checks, IAM policy generation, and
configuration writing.

This package must not import ingestlib. The wizard runs while the studio is
still unconfigured, and the library would read missing or stale files if it
loaded its configuration before the wizard finished writing them.
"""
