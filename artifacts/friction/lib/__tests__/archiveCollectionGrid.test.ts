import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const archiveScreen = readFileSync(join(appRoot, "app/(tabs)/archive.tsx"), "utf8");
const collectionDetailScreen = readFileSync(join(appRoot, "app/of-01-detail.tsx"), "utf8");

const sentenceCard = readFileSync(join(appRoot, "components/StoredSentenceCard.tsx"), "utf8");

describe("archive collection recent-letter previews", () => {
  it("sorts collection entries by added time and limits previews to three", () => {
    expect(archiveScreen).toContain("sortRecentCollectionArticles");
    expect(archiveScreen).toContain(
      "new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()",
    );
    expect(archiveScreen).toContain(".slice(0, COLLECTION_PREVIEW_LIMIT)");
    expect(archiveScreen).toContain("const COLLECTION_PREVIEW_LIMIT = 3");
  });

  it("uses the shared canonical cover card and the space-card three-column sizing", () => {
    expect(archiveScreen).toContain("<CollectionPreviewCards");
    expect(archiveScreen).toContain("<ArticleCardItem");
    expect(archiveScreen).toContain('title={entry.article?.title ?? "제목 없음"}');
    expect(archiveScreen).toContain("cover={entry.article?.cover}");
    expect(archiveScreen).toContain(
      "const coverWidth = Math.floor((availableWidth - 16) / 3);",
    );
    expect(archiveScreen).not.toContain("Math.min(\n    90,");
    expect(archiveScreen).toContain("coverWidth * Sizing.cardRatio");
    expect(archiveScreen).toContain(
      "const coverRadius = 16 * (coverWidth / Sizing.cardSlotW);",
    );
    expect(archiveScreen).toContain("cardWidth={coverWidth}");
    expect(archiveScreen).toContain("cardRadius={coverRadius}");
    expect(archiveScreen).not.toContain("<CanonicalCardSlot");
    const previewStyle = archiveScreen.slice(
      archiveScreen.indexOf("collectionPreviews:"),
      archiveScreen.indexOf("cardSpacer:", archiveScreen.indexOf("collectionPreviews:")),
    );
    expect(previewStyle).toContain('justifyContent: "flex-start"');
    expect(previewStyle).not.toContain('justifyContent: "center"');
  });

  it("shows author and collection metadata on preview covers, same as the space card", () => {
    expect(archiveScreen).toContain(
      "authorName={entry.article?.authorNickname ?? undefined}",
    );
    expect(archiveScreen).toContain(
      "collectionName={entry.article?.collectionName ?? undefined}",
    );
  });

  it("keeps the preview row height stable across 0-3 letters and async loading", () => {
    const previewStyle = archiveScreen.slice(
      archiveScreen.indexOf("collectionPreviews:"),
      archiveScreen.indexOf("cardSpacer:", archiveScreen.indexOf("collectionPreviews:")),
    );
    expect(previewStyle).toContain("minHeight: 119");
    expect(previewStyle).toContain('pointerEvents: "none"');
  });

  it("omits empty preview rows and keeps the collection card as the only action", () => {
    expect(archiveScreen).toContain("if (articles.length === 0) return null");
    expect(archiveScreen).toContain("disabled");
    expect(archiveScreen).toContain('pathname: "/of-01-detail"');
    expect(archiveScreen).not.toContain("onPreviewPress");
  });

  it("rerenders after asynchronous queries and refreshes previews on focus and pull", () => {
    expect(archiveScreen).toContain("useQueries");
    expect(archiveScreen).toContain("getListMyCollectionArticlesQueryOptions");
    expect(archiveScreen).toContain("refetchOnMount: false");
    expect(archiveScreen).toContain("refetchOnWindowFocus: false");
    expect(archiveScreen).toContain("recentArticlesByCollectionId");
    expect(archiveScreen).toContain("extraData={recentArticlesByCollectionId}");
    expect(archiveScreen).toContain(
      "...collectionArticleQueries.map((query) => query.refetch())",
    );
    expect(archiveScreen).toContain("for (const queryKey of collectionArticleQueryKeys)");
    expect(archiveScreen).toContain(
      "void queryClient.refetchQueries({ queryKey, exact: true })",
    );
  });

  it("lets collection cards grow around previews without fixed heights or filler slots", () => {
    const cardStyles = archiveScreen.slice(
      archiveScreen.indexOf("cardWrapper:"),
      archiveScreen.indexOf("listContent:", archiveScreen.indexOf("cardWrapper:")),
    );
    expect(cardStyles).not.toContain("\n    height:");
    expect(archiveScreen).not.toContain("collection-preview-filler");
  });
});

describe("archive collection detail controls", () => {
  it("uses fixed icon buttons with accessible selected states for card and list views", () => {
    expect(collectionDetailScreen).not.toContain("DropdownFilter");
    expect(collectionDetailScreen).toContain("function CollectionViewButton");
    expect(collectionDetailScreen).toContain('label="카드형으로 보기"');
    expect(collectionDetailScreen).toContain('label="목록형으로 보기"');
    expect(collectionDetailScreen).toContain('icon="layers"');
    expect(collectionDetailScreen).toContain('icon="list"');
    expect(collectionDetailScreen).toContain("accessibilityState={{ selected: active }}");
    expect(collectionDetailScreen).toContain("const VIEW_BUTTON_SIZE = 44");
    expect(collectionDetailScreen).toContain("width: VIEW_BUTTON_SIZE");
    expect(collectionDetailScreen).toContain("height: VIEW_BUTTON_SIZE");
  });

  it("opens the existing letter picker from the regular-collection management menu only", () => {
    const sectionHeader = collectionDetailScreen.slice(
      collectionDetailScreen.indexOf("<View style={styles.sectionHeader}>"),
      collectionDetailScreen.indexOf("</View>", collectionDetailScreen.indexOf("<View style={styles.sectionHeader}>")) + 7,
    );
    const managementMenu = collectionDetailScreen.slice(
      collectionDetailScreen.indexOf("<ActionSheetModal"),
      collectionDetailScreen.indexOf("</ActionSheetModal>", collectionDetailScreen.indexOf("<ActionSheetModal")),
    );

    expect(sectionHeader).not.toContain("편지 추가");
    expect(managementMenu).toContain('label: "편지 추가"');
    expect(managementMenu).toContain("setShowPicker(true)");
    expect(managementMenu).toContain("...(!isArchive && !isImpression ? [");
    expect(collectionDetailScreen).toContain("<MyArticlesPickerBottomSheet");
    expect(collectionDetailScreen).toContain("onSelect={handleAddArticles}");
  });

  it("preserves selection, rename, delete, and both content renderers", () => {
    expect(collectionDetailScreen).toContain('{ label: "선택"');
    expect(collectionDetailScreen).toContain('{ label: "모음 이름 변경"');
    expect(collectionDetailScreen).toContain('{ label: "모음 삭제"');
    expect(collectionDetailScreen).toContain('view === "card"');
    expect(collectionDetailScreen).toContain("renderItem={renderGridRow}");
    expect(collectionDetailScreen).toContain("renderItem={renderNormalItem}");
  });
});

describe("archive collection detail card grid parity", () => {
  const renderGridRow = collectionDetailScreen.slice(
    collectionDetailScreen.indexOf("const renderGridRow"),
    collectionDetailScreen.indexOf("const renderSelectionItem"),
  );

  it("shows sender and the letter's originating space name on the card cover, matching the 마이 탭 / 수신자만 볼 수 있는 편지 탭 grids", () => {
    expect(renderGridRow).toContain(
      "myArticleToViewModel(entry.article, spaceLetterByArticleId.get(entry.articleId) ?? null)",
    );
    expect(renderGridRow).toContain("authorName={vm?.authorName ?? undefined}");
    expect(renderGridRow).toContain("spaceName={vm?.spaceName}");
    // Never repeat this browsing collection's own name on every card cover —
    // vm?.collectionName resolves to whichever personal collection the
    // article was first saved to, which inside this exact collection's own
    // detail screen is always redundant (or, worse, a stray different
    // collection name if the article was saved elsewhere first).
    expect(renderGridRow).not.toContain("collectionName={vm?.collectionName}");
  });

  it("shows the letter's originating space (not this collection's own name) and a live spaceId in the overlay info bar", () => {
    expect(renderGridRow).toContain("collectionName: vm?.spaceName ?? collection?.name ?? null");
    expect(renderGridRow).toContain("collectionId: vm?.spaceName ? null : (id ?? null)");
    expect(renderGridRow).toContain("spaceId: vm?.spaceId ?? null");
  });

  it("always opens the letter selection overlay on tap, regardless of authorship", () => {
    expect(renderGridRow).not.toContain("entry.article.authorId === userId");
    expect(renderGridRow).not.toContain('pathname: "/read"');
    expect(renderGridRow).toContain("openLetterOverlay(entry.article,");
  });

  it("hides the tapped card slot while the overlay is open, like the other 3-column grids", () => {
    expect(renderGridRow).toContain("isSourceHidden(entry.articleId)");
    expect(renderGridRow).toContain("opacity: hidden ? 0 : 1");
  });

  it("measures the tapped card slot for the overlay's hero origin", () => {
    expect(renderGridRow).toContain("cardSlotRefs.current.get(entry.articleId)");
    expect(renderGridRow).toContain("measureRef: slotRef");
  });

  it("passes the masking-aware authorName/authorId into the overlay meta instead of the raw article fields", () => {
    // vm.authorId is null whenever the server marked this entry's author
    // identity as masked (foreign letter from an anonymous space) — passing
    // entry.article.authorId directly here would leak the real author via the
    // overlay's "navigate to author" link even when the name itself is safe.
    expect(renderGridRow).toContain("authorName: vm?.authorName ?? null");
    expect(renderGridRow).toContain("authorId: vm?.authorId ?? null");
    expect(renderGridRow).not.toContain("authorId: entry.article.authorId");
    expect(renderGridRow).not.toContain("authorId: entry.article?.authorId");
  });
});

describe("archive collection detail list view overlay parity", () => {
  const renderNormalItem = collectionDetailScreen.slice(
    collectionDetailScreen.indexOf("const renderNormalItem"),
    collectionDetailScreen.indexOf("if (!id) {"),
  );

  it("builds the same viewmodel as the card grid so the overlay shows author/space info consistently across both views", () => {
    expect(renderNormalItem).toContain(
      "myArticleToViewModel(\n                item.article,\n                spaceLetterByArticleId.get(item.articleId) ?? null,\n              )",
    );
    expect(renderNormalItem).toContain("collectionName: vm.spaceName ?? collection?.name ?? null");
    expect(renderNormalItem).toContain("collectionId: vm.spaceName ? null : (id ?? null)");
    expect(renderNormalItem).toContain("spaceId: vm.spaceId ?? null");
    expect(renderNormalItem).toContain("authorName: vm.authorName ?? null");
    expect(renderNormalItem).toContain("authorId: vm.authorId ?? null");
  });
});

describe("archive collected sentence list", () => {
  const sentenceFilterAction = archiveScreen.slice(
    archiveScreen.indexOf('{activeSubTab === "personal" ? ('),
    archiveScreen.indexOf("</View>", archiveScreen.indexOf('{activeSubTab === "personal" ? (')),
  );
  const regularRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceItem"),
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
  );
  const selectionRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
    archiveScreen.indexOf("const renderEmptyPersonal"),
  );

  it("uses the shared content-sized card surface and metadata layout", () => {
    expect(regularRenderer).toContain("<StoredSentenceCard");
    expect(selectionRenderer).toContain("<StoredSentenceCard");
    expect(archiveScreen).toContain("marginHorizontal: Spacing.screenPx");
    expect(archiveScreen).toContain("marginBottom: Spacing.cardGap");
    expect(sentenceCard).toContain("borderRadius: 16");
    expect(sentenceCard).toContain("...Shadows.card");
    expect(sentenceCard).toContain("fontFamily: ReaderTokens.fontFamily.serif");
    expect(sentenceCard).toContain('textAlign: "justify"');
    expect(sentenceCard).not.toContain("minHeight");
    expect(sentenceCard).not.toContain('justifyContent: "space-between"');
    expect(archiveScreen).toContain('item.sourceText || item.articleTitle || "출처 없음"');
  });

  it("shows complete sentence and source text without line limits or ellipses", () => {
    expect(regularRenderer).not.toContain("numberOfLines");
    expect(regularRenderer).not.toContain("ellipsizeMode");
    expect(selectionRenderer).not.toContain("numberOfLines");
    expect(selectionRenderer).not.toContain("ellipsizeMode");
    expect(sentenceCard).not.toContain("numberOfLines");
    expect(sentenceCard).not.toContain("ellipsizeMode");
  });

  it("lets long sources wrap beside a stable bottom-right date", () => {
    expect(sentenceCard).toContain('alignItems: "flex-end"');
    expect(sentenceCard).toContain("flex: 1");
    expect(sentenceCard).toContain("minWidth: 0");
    expect(sentenceCard).toContain("flexShrink: 0");
    expect(sentenceCard).toContain('textAlign: "right"');
  });

  it("renders non-interactive favorite badges without adding favorite actions", () => {
    expect(regularRenderer).toContain("isFavorite={item.isFavorite}");
    expect(regularRenderer).not.toContain("handleSentenceToggleFavorite");
    expect(selectionRenderer).toContain("isFavorite={item.isFavorite}");
    expect(sentenceCard).toContain('pointerEvents="none"');
    expect(archiveScreen).toContain("즐겨찾기됨");
    expect(sentenceCard).toContain('<AntDesign name="heart" size={16} color={Colors.noticeAccent} />');
    expect(sentenceCard).not.toContain('name="star"');
  });

  it("opens manual sentence creation from the shared outlined add action", () => {
    expect(sentenceFilterAction).toContain("<HeaderButton");
    expect(sentenceFilterAction).toContain('variant="add"');
    expect(sentenceFilterAction).not.toContain("styles.addButton");
    expect(sentenceFilterAction).not.toContain("styles.addButtonContent");
    expect(sentenceFilterAction).toContain("onPress={handleAdd}");
    expect(sentenceFilterAction).toContain("onLongPress={enterSelectionMode}");
    expect(sentenceFilterAction).toContain('accessibilityLabel="문장 추가"');
    expect(sentenceFilterAction).toContain('accessibilityHint="새 문장 추가 화면으로 이동합니다. 길게 누르면 문장 선택 모드가 열립니다"');
    expect(sentenceFilterAction).toContain('{ name: "activate", label: "문장 추가" }');
    expect(sentenceFilterAction).toContain('{ name: "longpress", label: "문장 선택 모드 열기" }');
    expect(sentenceFilterAction).toContain('nativeEvent.actionName === "longpress"');
    expect(sentenceFilterAction).toContain('nativeEvent.actionName === "activate"');
    expect(archiveScreen).toContain('router.push("/stored-sentence-create")');
  });

  it("reserves matching list and swipe overflow space for raised hearts", () => {
    expect(archiveScreen).toContain("const SENTENCE_BADGE_OVERFLOW = 12");
    expect(regularRenderer).toContain("overflowTop={SENTENCE_BADGE_OVERFLOW}");
    expect(archiveScreen).toContain("styles.sentenceListContent");
    expect(archiveScreen).toContain("paddingTop: SENTENCE_BADGE_OVERFLOW");
  });

  it("renders stored text without decorative quotation marks", () => {
    expect(regularRenderer).toContain("text={item.text}");
    expect(selectionRenderer).toContain("text={item.text}");
    expect(regularRenderer).not.toContain("&ldquo;");
    expect(selectionRenderer).not.toContain("&rdquo;");
  });

  it("preserves detail, swipe delete, and accessible multi-selection interactions", () => {
    expect(regularRenderer).toContain('pathname: "/stored-sentence-detail"');
    expect(regularRenderer).toContain("onDeletePress");
    expect(regularRenderer).toContain("onSwipeOpen");
    expect(selectionRenderer).toContain('accessibilityRole="checkbox"');
    expect(selectionRenderer).toContain("accessibilityState={{ checked: isSelected }}");
    expect(selectionRenderer).toContain("toggleSelect(item.id)");
    expect(archiveScreen).not.toContain("selectedSentence");
  });

  it("alternates archive filters on active-tab reselection through the shared cleanup path", () => {
    expect(archiveScreen).toContain("const { tabReselectVersion } = useNavigation()");
    expect(archiveScreen).toContain(
      "selectArchiveSubTab(advanceArchiveFilter(activeSubTab, reselectCount))",
    );
    expect(archiveScreen).toContain(
      "if (handledArchiveReselectVersionRef.current === tabReselectVersion.AR) return",
    );
    expect(archiveScreen).toContain("[tabReselectVersion.AR]");
    expect(archiveScreen).toContain('onPress={() => selectArchiveSubTab("personal")}');
    expect(archiveScreen).toContain('onPress={() => selectArchiveSubTab("sentence")}');
    expect(archiveScreen).toContain("closeSentenceOpenRow()");
    expect(archiveScreen).toContain("exitSelectionMode()");
  });
});

describe("manual stored sentence creation", () => {
  const createScreen = readFileSync(join(appRoot, "app/stored-sentence-create.tsx"), "utf8");

  it("uses the standard back and menu header around the editable detail card", () => {
    expect(createScreen).toContain('<HeaderButton variant="back"');
    expect(createScreen).toContain('<HeaderButton variant="menu"');
    expect(createScreen).toContain("<TextInput");
    expect(createScreen).toContain('accessibilityLabel="문장 본문"');
    expect(createScreen).toContain('accessibilityLabel="문장 출처"');
    expect(createScreen).toContain('placeholder="저자, <제목>, 면 수"');
    expect(createScreen).toContain("multiline");
    expect(createScreen).toContain("minHeight: 280");
  });

  it("saves the body and optional custom source, then refreshes the archive", () => {
    expect(createScreen).toContain("useCreateStoredSentence()");
    expect(createScreen).toContain("text: bodyText.trim()");
    expect(createScreen).toContain("sourceText: sourceText.trim() || null");
    expect(createScreen).not.toContain('articleId: "custom"');
    expect(createScreen).toContain("getListStoredSentencesQueryKey({ userId })");
    expect(createScreen).toContain("router.back()");
  });
});

describe("stored sentence detail route", () => {
  const detailScreen = readFileSync(join(appRoot, "app/stored-sentence-detail.tsx"), "utf8");

  it("uses the single-item query and exposes every supported menu action", () => {
    expect(detailScreen).toContain("useGetStoredSentence(sentenceId");
    expect(detailScreen).toContain('"복사하기"');
    expect(detailScreen).toContain('"즐겨찾기 해제"');
    expect(detailScreen).toContain('"인용하여 메모 작성"');
    expect(detailScreen).toContain('"원본으로 이동"');
    expect(detailScreen).toContain('"삭제"');
    expect(detailScreen).toContain("...(sentence.articleId ?");
  });

  it("keeps typography, source fallbacks, scrolling, and deletion cache refresh explicit", () => {
    expect(detailScreen).toContain("ReaderTokens.typeScale.bodyCqi");
    expect(detailScreen).toContain("<StoredSentenceCard");
    expect(sentenceCard).toContain('fontFamily: ReaderTokens.fontFamily.serifBold');
    expect(detailScreen).toContain('"제목 없는 원문"');
    expect(detailScreen).toContain('"저장 위치 없음"');
    expect(detailScreen).toContain('"저자 미상"');
    expect(detailScreen).toContain("sentence.sourceText?.trim()");
    expect(detailScreen).toContain("sentence.articleAuthorName");
    expect(detailScreen).toContain("}, <${sentence.articleTitle");
    expect(detailScreen).toContain("new Date(sentence.createdAt).toLocaleDateString");
    expect(detailScreen).toContain("<ScrollView");
    expect(detailScreen).toContain("invalidateQueries({ queryKey: getListStoredSentencesQueryKey");
    expect(detailScreen).toContain("router.back()");
  });

  it("shows a passive favorite badge and optimistically updates every sentence cache", () => {
    expect(detailScreen).toContain("isFavorite={sentence.isFavorite}");
    expect(sentenceCard).toContain('pointerEvents="none"');
    expect(sentenceCard).toContain('name="heart"');
    expect(detailScreen).toContain("optimisticallySetStoredSentenceFavorite");
    expect(detailScreen).toContain("applyStoredSentenceFavoriteResponse");
    expect(detailScreen).toContain("rollbackStoredSentenceFavorite");
  });

  it("renders sentence text without decorative quotation marks", () => {
    expect(detailScreen).toContain("text={sentence.text}");
    expect(detailScreen).not.toContain("&ldquo;");
    expect(detailScreen).not.toContain("&rdquo;");
  });
});
