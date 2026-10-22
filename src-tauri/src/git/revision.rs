use super::RepositorySnapshot;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::Path,
};

pub(super) fn hash(value: &impl Hash) -> String {
    let mut state = DefaultHasher::new();
    value.hash(&mut state);
    format!("{:016x}", state.finish())
}

fn hash_metadata(path: &Path, state: &mut impl Hasher) {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            metadata.len().hash(state);
            metadata.modified().ok().hash(state);
            metadata.file_type().hash(state);
        }
        Err(error) => error.kind().hash(state),
    }
}

// Git status alone cannot distinguish two edits to an already modified file.
// Include inexpensive file stamps, the index, and script inputs so quiet polls
// can skip publishing identical snapshots without hiding those changes.
pub(super) fn fingerprint(root: &Path, git_dir: &Path, snapshot: &RepositorySnapshot) -> String {
    let mut state = DefaultHasher::new();
    snapshot.hash(&mut state);
    hash_metadata(&git_dir.join("index"), &mut state);
    for file in &snapshot.files {
        hash_metadata(&root.join(&file.path), &mut state);
        if let Some(old_path) = &file.old_path {
            hash_metadata(&root.join(old_path), &mut state);
        }
    }
    for file in [
        "package.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
        "package-lock.json",
    ] {
        let path = root.join(file);
        hash_metadata(&path, &mut state);
        // Script discovery reads through symlinks; track the target as well.
        if let Ok(metadata) = fs::metadata(path) {
            metadata.len().hash(&mut state);
            metadata.modified().ok().hash(&mut state);
        }
    }
    format!("{:016x}", state.finish())
}
