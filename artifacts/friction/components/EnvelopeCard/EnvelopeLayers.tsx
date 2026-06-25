import React from "react";
import { Image, StyleSheet } from "react-native";
import { Sizing } from "@/constants/tokens";

const CARD_W = Sizing.cardSlotW;

// Mockup artwork (see "편지 봉투 시스템 구현 디테일 가이드").
const INSIDE = require("@/assets/images/envelope_inside.png"); // 봉투 안쪽 (slightly gray)
const POCKET = require("@/assets/images/envelope_pocket.png"); // 봉투 포켓 (white, V-notch top)
const FLAP_CLOSED = require("@/assets/images/envelope_flap_closed.png"); // 닫힌 봉투 덮개 (white + wax seal)
const FLAP_OPEN = require("@/assets/images/envelope_flap_open.png"); // 열린 봉투 덮개 (gray inner + wax seal)

// Intrinsic aspect ratios (height / width) of the artwork.
const FLAP_OPEN_RATIO = 596 / 450;

interface LayerProps {
  cardWidth?: number;
}

/**
 * Layer — 봉투 안쪽 (envelope inside). The inner back face the letter card
 * sits on once the envelope is flipped open. Slightly gray, rounded radius.
 * Full card sized.
 */
export function EnvelopeBackFace({ cardWidth }: LayerProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  return (
    <Image
      source={INSIDE}
      style={[StyleSheet.absoluteFill, { width: w, height: h }]}
      resizeMode="stretch"
    />
  );
}

/**
 * Layer — 봉투 포켓 (envelope pocket). The white outer pocket with a V-notch
 * cut at the top through which the letter shows. Rounded bottom radius.
 * Full card sized, sits above the letter card.
 */
export function EnvelopePocketFront({ cardWidth }: LayerProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  return (
    <Image
      source={POCKET}
      style={[StyleSheet.absoluteFill, { width: w, height: h }]}
      resizeMode="stretch"
    />
  );
}

/**
 * Layer — 닫힌 봉투 덮개 (closed flap). White outer face with the wax seal,
 * rounded top corners. Full card sized; the triangle occupies the top portion
 * with its base on the card's top edge, so it rotates correctly around that
 * hinge. The lower portion of the artwork is transparent.
 */
export function EnvelopeFlapClosed({ cardWidth }: LayerProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  return (
    <Image
      source={FLAP_CLOSED}
      style={{ width: w, height: h }}
      resizeMode="stretch"
    />
  );
}

/**
 * Layer — 열린 봉투 덮개 (open flap). The gray inner face shown once the flap
 * has opened, with the wax seal near the top. Drawn at its own aspect ratio
 * (shorter than a full card) and anchored to the top edge. Sits below the
 * letter card so it never covers the card while sliding away.
 */
export function EnvelopeFlapOpen({ cardWidth }: LayerProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * FLAP_OPEN_RATIO;
  return (
    <Image
      source={FLAP_OPEN}
      style={{ position: "absolute", top: 0, left: 0, width: w, height: h }}
      resizeMode="stretch"
    />
  );
}
