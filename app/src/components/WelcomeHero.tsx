import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import { STRINGS } from '../constants/strings';
import { getHeroGeometry } from '../constants/heroGeometry';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';
import { WORDMARK_BOX, WORDMARK_PATHS } from './Wordmark';

export interface WelcomeHeroProps {
  width?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
}

/**
 * A VUE WelcomeHero Component
 * Single unified SVG composition of ClapperMark and CharacterArt in ONE coordinate system.
 * - Bounding box x in [119.5, 286], y in [54, 195] (left edge of raised lid to right edge of shadow)
 * - Board bottom and feet sit on the SAME ground line (y = 190)
 * - ViewBox: "112.75 48 180 152" (symmetrically centered on x = 202.75, zero center offset)
 * - Zero clipping: person's raised hand, lid, shadow, feet all within viewBox
 * - Token fills:
 *   Board: palette primary 40 (#FD550A)
 *   Panel: palette neutral 6 (#1A110F, dark surface)
 *   Name: palette primary 80 (#FFCEBE, A1 chevron filled lettering)
 *   Lid stripes: brand crest yellow (#E0F354)
 */
export const WelcomeHero: React.FC<WelcomeHeroProps> = ({
  width = 240,
  accessibilityLabel,
  style,
  testID,
  pointerEvents = 'none',
}) => {
  const geometry = getHeroGeometry();
  const { viewBox } = geometry;

  const aspectRatio = viewBox.width / viewBox.height; // 172 / 152 = 1.1316
  const height = width / aspectRatio; // ~212 for width=240

  // Direct palette tokens
  const boardColor = colorData.palettes.primary['40']; // #FD550A
  const panelColor = colorData.palettes.neutral_extra_tones['6']; // #1A110F
  const nameColor = colorData.palettes.primary['80']; // #FFCEBE
  const stripeColor = colorData.brand.crest_yellow; // #E0F354

  // Board dimensions inside translate(80, 40)
  const boardX = 46;
  const boardY = 92;
  const boardW = 108;
  const boardH = 58;
  const boardRx = 4;

  // Panel geometry
  const panelX = boardX + 0.065 * boardW; // 53.02
  const panelY = boardY + 0.175 * boardH; // 102.15
  const panelW = 0.87 * boardW; // 93.96
  const panelH = 0.65 * boardH; // 37.70
  const panelRx = 0.046 * boardW; // 4.97

  // Wordmark placement (centred inside panel with A1 chevron filled lettering)
  const nameW = 0.64 * boardW; // 69.12
  const nameScale = nameW / WORDMARK_BOX.w; // 69.12 / 578 ≈ 0.11958
  const nameLettersH = (WORDMARK_BOX.bottom - WORDMARK_BOX.top) * nameScale;
  const nameX = panelX + (panelW - nameW) / 2; // 65.44
  const nameY = panelY + (panelH - nameLettersH) / 2 - WORDMARK_BOX.top * nameScale; // 114.39

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || STRINGS.appName}
      style={[
        {
          width,
          height,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Svg
        pointerEvents="none"
        width={width}
        height={height}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        fill="none"
        accessible={false}
        aria-hidden={true}
      >
        {/* ================= 1. CLAPPERBOARD (at stage x=80, y=40) ================= */}
        <G transform="translate(80, 40)">
          {/* Board body (bottom sits on y = 40 + 92 + 58 = 190) */}
          <Rect
            x={boardX}
            y={boardY}
            width={boardW}
            height={boardH}
            rx={boardRx}
            fill={boardColor}
          />

          {/* Dark panel replacing the two bars */}
          <Rect
            x={panelX}
            y={panelY}
            width={panelW}
            height={panelH}
            rx={panelRx}
            fill={panelColor}
          />

          {/* Wordmark inside panel (filled A1 chevron lettering) */}
          <G transform={`translate(${nameX}, ${nameY}) scale(${nameScale})`}>
            <G fill={nameColor}>
              {WORDMARK_PATHS.map((item) => (
                <Path
                  key={item.id}
                  d={item.d}
                />
              ))}
            </G>
          </G>

          {/* Lid raised open (-24deg around 46, 88) */}
          <G transform="rotate(-24 46 88)">
            <Rect
              x={46}
              y={72}
              width={108}
              height={16}
              fill={stripeColor}
            />
            <Polygon points="62,72 76,72 70,88 56,88" fill={panelColor} />
            <Polygon points="92,72 106,72 100,88 86,88" fill={panelColor} />
            <Polygon points="122,72 136,72 130,88 116,88" fill={panelColor} />
          </G>
        </G>

        {/* ================= 2. CHARACTER (at stage x=266, y=190) ================= */}
        <G transform="translate(266, 190)">
          {/* Ground shadow (feet sit on ground line y = 190) */}
          <Ellipse cx={0} cy={1} rx={20} ry={4} fill="#000000" opacity={0.4} />

          <G>
            {/* Far leg */}
            <G>
              <Line
                x1={0}
                y1={-70}
                x2={0}
                y2={-36}
                stroke="#53433F"
                strokeWidth={11}
                strokeLinecap="round"
              />
              <G transform="rotate(-1 0 -36)">
                <Line
                  x1={0}
                  y1={-36}
                  x2={0}
                  y2={-6}
                  stroke="#53433F"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                <Rect x={-11} y={-6} width={17} height={7} rx={3.5} fill="#A08D87" />
              </G>
            </G>

            {/* Near leg */}
            <G>
              <Line
                x1={0}
                y1={-70}
                x2={0}
                y2={-36}
                stroke="#6B5B56"
                strokeWidth={11}
                strokeLinecap="round"
              />
              <G transform="rotate(-1 0 -36)">
                <Line
                  x1={0}
                  y1={-36}
                  x2={0}
                  y2={-6}
                  stroke="#6B5B56"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                <Rect x={-11} y={-6} width={17} height={7} rx={3.5} fill="#D8C2BB" />
              </G>
            </G>

            {/* Leaning torso and upper body (rotate -9deg at 0, -70) */}
            <G transform="rotate(-9 0 -70)">
              {/* Far arm (rotate 21.9deg at 0, -104) */}
              <G transform="rotate(21.9 0 -104)">
                <Line
                  x1={0}
                  y1={-104}
                  x2={0}
                  y2={-78}
                  stroke="#00513D"
                  strokeWidth={7}
                  strokeLinecap="round"
                />
                <G transform="rotate(8 0 -78)">
                  <Line
                    x1={0}
                    y1={-78}
                    x2={0}
                    y2={-54}
                    stroke="#9D8D89"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <Circle cx={0} cy={-51} r={4} fill="#9D8D89" />
                </G>
              </G>

              {/* Green top */}
              <Path
                d="M-8 -108 C-12 -98 -11 -82 -9 -68 L9 -68 C11 -82 11 -98 7 -108 Z"
                fill="#1B6A54"
              />

              {/* Projector head & lens & eyes (rotate -5deg at 0, -108) */}
              <G transform="rotate(-5 0 -108)">
                <Rect x={-3} y={-113} width={6} height={8} fill="#9D8D89" />
                <Rect x={-14} y={-134} width={25} height={22} rx={4} fill="#FD550A" />
                <Rect x={-21} y={-128} width={8} height={12} rx={2} fill="#E0F354" />
                <G>
                  <Circle cx={-6} cy={-123} r={5} fill="#F1DFDA" />
                  <Circle cx={4} cy={-123} r={5} fill="#F1DFDA" />
                  <Circle cx={-7.3} cy={-122.5} r={2.4} fill="#1A110F" />
                  <Circle cx={2.7} cy={-122.5} r={2.4} fill="#1A110F" />
                </G>
              </G>

              {/* Near arm lifting clapper lid (rotate 68.5deg at 0, -104) */}
              <G transform="rotate(68.5 0 -104)">
                <Line
                  x1={0}
                  y1={-104}
                  x2={0}
                  y2={-78}
                  stroke="#1B6A54"
                  strokeWidth={7}
                  strokeLinecap="round"
                />
                <G transform="rotate(80 0 -78)">
                  <Line
                    x1={0}
                    y1={-78}
                    x2={0}
                    y2={-54}
                    stroke="#BCA7A1"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <Circle cx={0} cy={-51} r={4} fill="#BCA7A1" />
                </G>
              </G>
            </G>
          </G>
        </G>
      </Svg>
    </View>
  );
};

