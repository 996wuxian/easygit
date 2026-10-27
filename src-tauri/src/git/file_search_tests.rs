use super::*;

fn request(root: &std::path::Path, query: &str, mode: FileSearchMode) -> FileSearchRequest {
    FileSearchRequest {
        path: root.to_str().unwrap().into(),
        client: "test-client".into(),
        generation: 1,
        query: query.into(),
        mode,
        show_ignored: false,
        continuation: false,
    }
}

fn collect(
    state: &FileSearchState,
    mut request: FileSearchRequest,
) -> (Vec<FileSearchMatch>, FileSearchBatch, usize) {
    let mut results = Vec::new();
    let mut pages = 0;
    loop {
        let mut batch = search_project_files(state, request.clone()).unwrap();
        assert!(batch.results.len() <= PAGE_SIZE);
        pages += 1;
        results.append(&mut batch.results);
        if batch.complete {
            return (results, batch, pages);
        }
        request.continuation = true;
    }
}

#[test]
fn finds_utf8_content_with_crlf_bom_and_utf16_editor_positions() {
    let repository = crate::git::tests::repo();
    let root = repository.path();
    fs::write(
        root.join("中文 file.txt"),
        "\u{feff}头部\r\n😀 中文 needLE 值\r\n",
    )
    .unwrap();
    let state = FileSearchState::default();
    let (matches, batch, _) = collect(&state, request(root, "needle", FileSearchMode::Content));
    assert_eq!(matches.len(), 1);
    let found = &matches[0];
    assert_eq!(found.path, "中文 file.txt");
    assert_eq!(
        (found.line, found.column, found.length),
        (Some(2), Some(7), Some(6))
    );
    let utf16: Vec<_> = found.preview.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&utf16[found.match_start..found.match_start + found.match_length])
            .unwrap(),
        "needLE"
    );
    assert!(batch.complete && !batch.truncated);
}

#[test]
fn filename_and_literal_content_modes_are_distinct_and_include_untracked_files() {
    let repository = crate::git::tests::repo();
    let root = repository.path();
    fs::write(root.join("Needle.ts"), "a.b literal\n").unwrap();
    fs::write(root.join("other.ts"), "needle\naXb\n").unwrap();
    crate::git::run(root, &["add", "Needle.ts"]).unwrap();
    let (names, _, _) = collect(
        &FileSearchState::default(),
        request(root, "needle", FileSearchMode::Name),
    );
    assert_eq!(names.len(), 1);
    assert_eq!(names[0].path, "Needle.ts");
    assert!(names[0].line.is_none());
    let (content, _, _) = collect(
        &FileSearchState::default(),
        request(root, "needle", FileSearchMode::Content),
    );
    assert_eq!(content.len(), 1);
    assert_eq!(content[0].path, "other.ts");
    let (literal, _, _) = collect(
        &FileSearchState::default(),
        request(root, "a.b", FileSearchMode::Content),
    );
    assert_eq!(literal.len(), 1);
    assert_eq!(literal[0].path, "Needle.ts");
}

#[test]
fn skips_ignored_dependencies_binary_large_and_nested_files_by_default() {
    let repository = crate::git::tests::repo();
    let root = repository.path();
    fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
    fs::write(root.join("main.txt"), "needle").unwrap();
    fs::write(root.join("ignored.txt"), "needle").unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::write(root.join("node_modules/pkg/index.js"), "needle").unwrap();
    fs::write(root.join("binary.bin"), b"needle\0").unwrap();
    fs::write(root.join("invalid.bin"), b"needle\xff").unwrap();
    fs::write(root.join("large.txt"), "needle".repeat(MAX_BYTES / 6 + 1)).unwrap();
    fs::create_dir(root.join("nested")).unwrap();
    fs::write(root.join("nested/.git"), "gitdir: somewhere").unwrap();
    fs::write(root.join("nested/file.txt"), "needle").unwrap();
    let (matches, batch, _) = collect(
        &FileSearchState::default(),
        request(root, "needle", FileSearchMode::Content),
    );
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].path, "main.txt");
    assert!(batch.skipped_files >= 4);
    let mut all = request(root, "needle", FileSearchMode::Content);
    all.show_ignored = true;
    let (matches, _, _) = collect(&FileSearchState::default(), all);
    let paths: HashSet<_> = matches.iter().map(|found| found.path.as_str()).collect();
    assert_eq!(
        paths,
        HashSet::from(["main.txt", "ignored.txt", "node_modules/pkg/index.js"])
    );
}

#[test]
fn pagination_reuses_the_file_list_and_bounds_results_per_file_and_total() {
    let repository = crate::git::tests::repo();
    let root = repository.path();
    for index in 0..60 {
        fs::write(
            root.join(format!("file-{index:03}.txt")),
            "needle\n".repeat(21),
        )
        .unwrap();
    }
    let state = FileSearchState::default();
    let mut query = request(root, "needle", FileSearchMode::Content);
    let first = search_project_files(&state, query.clone()).unwrap();
    assert!(!first.complete);
    fs::write(root.join("new-needle.txt"), "needle").unwrap();
    query.continuation = true;
    let (mut matches, batch, pages) = collect(&state, query);
    matches.extend(first.results);
    assert_eq!(matches.len(), RESULT_LIMIT);
    assert!(batch.truncated && pages >= 19);
    assert!(matches.iter().all(|found| found.path != "new-needle.txt"));
    let mut counts = HashMap::new();
    for found in matches {
        *counts.entry(found.path).or_insert(0) += 1;
    }
    assert!(counts.values().all(|count| *count <= PER_FILE_LIMIT));
    assert!(batch.limited_files > 0);
}

#[test]
fn cancellation_tombstones_reject_late_starts_and_do_not_cancel_new_generations() {
    let repository = crate::git::tests::repo();
    fs::write(repository.path().join("file.txt"), "needle").unwrap();
    let state = FileSearchState::default();
    let query = request(repository.path(), "needle", FileSearchMode::Content);
    state.cancel(&query.client, 1).unwrap();
    assert_eq!(
        search_project_files(&state, query.clone()).unwrap_err(),
        CANCELLED
    );
    let mut next = query;
    next.generation = 2;
    assert_eq!(
        search_project_files(&state, next.clone())
            .unwrap()
            .results
            .len(),
        1
    );
    state.cancel(&next.client, 1).unwrap();
    assert!(!state.sessions.lock().unwrap()[&next.client]
        .cancelled
        .load(Ordering::Relaxed));
    assert!(read_content(&repository.path().join("file.txt"), &AtomicBool::new(true)).is_err());
}

#[test]
fn changing_continuation_conditions_is_rejected_and_search_does_not_take_git_write_lock() {
    let repository = crate::git::tests::repo();
    for index in 0..60 {
        fs::write(
            repository.path().join(format!("file-{index}.txt")),
            "needle",
        )
        .unwrap();
    }
    let state = FileSearchState::default();
    let mut query = request(repository.path(), "needle", FileSearchMode::Content);
    assert!(
        !search_project_files(&state, query.clone())
            .unwrap()
            .complete
    );
    query.continuation = true;
    query.query = "different".into();
    assert!(search_project_files(&state, query)
        .unwrap_err()
        .contains("搜索条件已变化"));
    let query = request(repository.path(), "file", FileSearchMode::Name);
    super::super::with_repository(repository.path().to_str().unwrap(), |_| {
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            send.send(search_project_files(&FileSearchState::default(), query))
                .ok();
        });
        assert!(receive
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .is_ok());
        Ok(())
    })
    .unwrap();
}

#[test]
#[ignore = "manual filesystem search benchmark"]
fn profile_large_project_search() {
    let repository = crate::git::tests::repo();
    let root = repository.path();
    for index in 0..5000 {
        fs::write(
            root.join(format!("file-{index:05}.txt")),
            if index % 50 == 0 {
                "const message = 'search-token';\n"
            } else {
                "const message = 'ordinary source';\n"
            },
        )
        .unwrap();
    }
    let state = FileSearchState::default();
    let mut query = request(root, "search-token", FileSearchMode::Content);
    let start = Instant::now();
    let first = search_project_files(&state, query.clone()).unwrap();
    let first_ms = start.elapsed().as_millis();
    let mut total = first.results.len();
    let mut pages = 1;
    let mut complete = first.complete;
    while !complete {
        query.continuation = true;
        let next = search_project_files(&state, query.clone()).unwrap();
        total += next.results.len();
        pages += 1;
        complete = next.complete;
    }
    assert_eq!(total, 100);
    println!(
        "5000 files, first page {first_ms} ms, total {} ms, {pages} pages, {total} matches",
        start.elapsed().as_millis()
    );
}
