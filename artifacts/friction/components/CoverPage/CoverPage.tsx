import React from "react";
import type { ArticleCover } from "@workspace/api-client-react";
import ArticleCardCover from "@/components/ArticleCardItem/ArticleCardCover";

interface CoverPageProps {
  cover: ArticleCover;
  title: string;
  authorName?: string;
  containerWidth: number;
  containerHeight: number;
  onImageLoad?: () => void;
}

export default function CoverPage({
  cover,
  title,
  authorName,
  containerWidth,
  containerHeight,
  onImageLoad,
}: CoverPageProps) {
  return (
    <ArticleCardCover
      cover={cover}
      title={title}
      authorName={authorName}
      width={containerWidth}
      height={containerHeight}
      onImageLoad={onImageLoad}
    />
  );
}