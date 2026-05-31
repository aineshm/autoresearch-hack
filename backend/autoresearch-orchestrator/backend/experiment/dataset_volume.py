"""Modal Volume hosting for the demo dataset (ALFA UAV fault/anomaly).

Hosts the dataset on a named, persistent Modal Volume so every experiment
sandbox can mount it read-only at a fixed path — uploaded once, reused across
all experiments. This matches the fresh-sandbox-per-experiment design in
`modal_runner.py`: the sandbox image stays tiny, and the (large) dataset lives
in durable storage instead of being baked into each sandbox.

Two pieces:
  * `populate` — a Modal function that streams the dataset zips from Figshare
    DIRECTLY into the mounted volume (server-side; the bytes never touch the
    caller's machine), unzips, and commits. Idempotent: skips files already
    extracted, so re-runs are free.
  * `mount_handle()` — returns a read-only Volume handle the runner attaches to
    `Sandbox.create(volumes={DATASET_MOUNT_PATH: handle})`.

Verified against modal 1.4.3:
  * `Sandbox.create(..., volumes={path: vol})`        — accepts a volumes map
  * `Volume.read_only()`                               — read-only handle
  * `Volume.from_name(name, create_if_missing=True)`   — lazy create
  * `volume.commit()`                                  — explicit durable flush

Run the populate step with:
    PYTHONPATH=. modal run backend/experiment/dataset_volume.py
or the cheap smoke test with:
    PYTHONPATH=. modal run backend/experiment/dataset_volume.py::smoke
"""

from __future__ import annotations

import modal

# ---------------------------------------------------------------------------
# Shared constants — the single source of truth for "where the dataset lives".
# Both the populate function and the experiment runner import these.
# ---------------------------------------------------------------------------

DATASET_VOLUME_NAME = "alfa-dataset"
DATASET_MOUNT_PATH = "/data/alfa"

# ALFA: A Dataset for UAV Fault and Anomaly Detection (CMU KiltHub / Figshare).
# DOI 10.1184/R1/12707963.v1. Direct Figshare `ndownloader` URLs (302 -> S3,
# no auth). README/version files are tiny; the four zips are the payload.
ALFA_FILES: tuple[tuple[str, str], ...] = (
    ("processed.zip", "https://ndownloader.figshare.com/files/24095870"),
    ("raw.zip", "https://ndownloader.figshare.com/files/24095969"),
    ("dataflash.zip", "https://ndownloader.figshare.com/files/24096047"),
    ("telemetry.zip", "https://ndownloader.figshare.com/files/24098393"),
    ("README.txt", "https://ndownloader.figshare.com/files/24098639"),
    ("Version_History.txt", "https://ndownloader.figshare.com/files/24098642"),
)

# Module-level Modal objects. `create_if_missing=True` makes the volume the
# first time anything references it; subsequent runs reuse the same volume.
app = modal.App("alfa-dataset-host")
volume = modal.Volume.from_name(DATASET_VOLUME_NAME, create_if_missing=True)

# Image only needs the stdlib + a couple of helpers for the server-side fetch.
_populate_image = modal.Image.debian_slim(python_version="3.12")


def mount_handle() -> "modal.Volume":
    """Return a READ-ONLY handle to the dataset volume for sandbox mounting.

    The experiment runner attaches this via
    `Sandbox.create(volumes={DATASET_MOUNT_PATH: mount_handle()})` so sandboxes
    can read the dataset but never mutate it.

    Imports `modal` at call time (not the module-level binding) so the handle is
    built against whatever `modal` is active when the runner invokes it — this
    keeps the runner's tests, which inject a fake `modal`, hermetic.
    """
    import modal as _modal  # noqa: PLC0415

    return _modal.Volume.from_name(
        DATASET_VOLUME_NAME, create_if_missing=True
    ).read_only()


@app.function(image=_populate_image, volumes={"/vol": volume}, timeout=1800)
def populate(force: bool = False) -> dict[str, str]:
    """Download + unzip the ALFA dataset into the volume (server-side).

    Idempotent: a file is skipped if its expected extraction marker already
    exists, unless ``force=True``. Streams each download to disk in chunks so
    memory stays flat regardless of the 1.75 GB total. Commits at the end so
    the bytes are durable and visible to sandboxes that mount the volume later.
    """
    import shutil
    import urllib.request
    import zipfile
    from pathlib import Path

    root = Path("/vol")
    root.mkdir(parents=True, exist_ok=True)
    status: dict[str, str] = {}

    for name, url in ALFA_FILES:
        is_zip = name.endswith(".zip")
        # For zips, the extracted dir is the marker; for plain files, the file.
        marker = root / (name[:-4] if is_zip else name)
        if marker.exists() and not force:
            status[name] = "skipped (already present)"
            print(f"[populate] {name}: already present at {marker}, skipping")
            continue

        dest = root / name
        print(f"[populate] downloading {name} from {url} ...")
        # urllib follows the 302 -> S3 redirect by default. Stream in chunks.
        with urllib.request.urlopen(url) as resp, open(dest, "wb") as fh:  # noqa: S310
            shutil.copyfileobj(resp, fh, length=1024 * 1024)
        size_mb = dest.stat().st_size / 1e6
        print(f"[populate] {name}: downloaded {size_mb:.1f} MB")

        if is_zip:
            stem = name[:-4]
            target = root / stem
            if target.exists():
                shutil.rmtree(target)
            # Extract to a staging dir first so we can flatten a redundant
            # single top-level folder (these zips wrap everything in a folder
            # named like the zip, which would yield /vol/processed/processed/...).
            staging = root / f".{stem}.staging"
            if staging.exists():
                shutil.rmtree(staging)
            staging.mkdir(parents=True, exist_ok=True)
            print(f"[populate] {name}: extracting -> {target}")
            with zipfile.ZipFile(dest) as zf:
                zf.extractall(staging)
            dest.unlink()  # drop the zip; keep only extracted contents

            entries = list(staging.iterdir())
            if len(entries) == 1 and entries[0].is_dir() and entries[0].name == stem:
                # Hoist the inner folder up: /vol/processed <- staging/processed
                entries[0].rename(target)
                staging.rmdir()
                print(f"[populate] {name}: flattened redundant '{stem}/' level")
            else:
                staging.rename(target)
            status[name] = f"extracted -> {target.name}/"
        else:
            status[name] = f"stored ({size_mb:.3f} MB)"

    # Explicit commit: persist to durable storage so later mounts see the data.
    volume.commit()
    print("[populate] committed volume; contents:")
    for entry in sorted(p.name for p in root.iterdir()):
        print(f"  - {entry}")
    return status


# ---------------------------------------------------------------------------
# Cheap end-to-end smoke test — proves the WHOLE mechanism (write + commit +
# read-only mount + sandbox visibility) for pennies, before the big download.
# ---------------------------------------------------------------------------

@app.function(image=_populate_image, volumes={"/vol": volume}, timeout=120)
def _write_probe() -> str:
    from pathlib import Path

    marker = Path("/vol/_smoke_probe.txt")
    marker.write_text("alfa-volume-smoke-ok\n", encoding="utf-8")
    volume.commit()
    return "wrote /vol/_smoke_probe.txt and committed"


@app.local_entrypoint()
def smoke() -> None:
    """Write a tiny file + commit, then RO-mount the volume in a sandbox and
    read it back. Validates the exact mechanism the runner depends on."""
    print("[smoke]", _write_probe.remote())

    image = modal.Image.debian_slim(python_version="3.12")
    sb = modal.Sandbox.create(
        app=app,
        image=image,
        timeout=120,
        volumes={DATASET_MOUNT_PATH: mount_handle()},
    )
    try:
        proc = sb.exec(
            "bash",
            "-c",
            f"echo '--- contents of {DATASET_MOUNT_PATH} ---'; "
            f"ls -la {DATASET_MOUNT_PATH}; "
            f"echo '--- probe file ---'; cat {DATASET_MOUNT_PATH}/_smoke_probe.txt; "
            # Prove it is read-only: this write MUST fail.
            f"echo '--- read-only check (expect failure) ---'; "
            f"(touch {DATASET_MOUNT_PATH}/_should_fail && echo 'ERROR: write succeeded') "
            f"|| echo 'OK: volume is read-only (write rejected)'",
            text=True,
        )
        print(proc.stdout.read())
        err = proc.stderr.read()
        if err:
            print("[smoke][stderr]", err)
        proc.wait()
    finally:
        sb.terminate()
    print("[smoke] done — RO mount + commit visibility verified")


@app.local_entrypoint()
def main(force: bool = False) -> None:
    """Default entrypoint: run the real dataset populate.

    Pass ``--force`` to re-download and re-extract even if files already exist.
    """
    result = populate.remote(force=force)
    print("\n=== populate result ===")
    for name, state in result.items():
        print(f"  {name}: {state}")
