import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { G, Path, Polygon, Rect } from 'react-native-svg';
import { STRINGS } from '../constants/strings';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';
import { WORDMARK_PATHS } from './Wordmark';

export interface ClapperMarkProps {
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE ClapperMark Component
 * Unified brand logo: clapperboard with raised lid, dark panel, and wordmark inside.
 * Design (agreed):
 * - Board: palette primary 40 (#FD550A)
 * - Panel: palette neutral 6 (#1A110F, dark surface token)
 * - Name: palette primary 80 (#FFCEBE), always, in light AND dark theme
 * - Lid stripes: brand crest yellow (#E0F354)
 * - Geometry proportions of board W=108, H=58 at (46, 92):
 *   Inset left: 6.5% W (7.02) -> x=53.02
 *   Inset top: 17.5% H (10.15) -> y=102.15
 *   Width: 87% W (93.96)
 *   Height: 65% H (37.70)
 *   Corner radius: 4.6% W (4.97)
 *   Name centred, width: 69% W (74.52) -> x=62.74, y=112.13, scale=0.44357
 */
export const ClapperMark: React.FC<ClapperMarkProps> = ({
  size = 140,
  accessibilityLabel,
  style,
  testID,
}) => {
  const effectiveLabel = accessibilityLabel || STRINGS.appName;

  // Direct palette tokens (do not switch with theme per DESIGN specification)
  const boardColor = colorData.palettes.primary['40']; // #FD550A
  const panelColor = colorData.palettes.neutral_extra_tones['6']; // #1A110F (dark surface)
  const nameColor = colorData.palettes.primary['80']; // #FFCEBE (palette primary 80)
  const stripeColor = colorData.brand.crest_yellow; // #E0F354 (brand crest yellow)

  // Board dimensions
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

  // Wordmark placement (centred inside panel)
  const nameW = 0.69 * boardW; // 74.52
  const nameScale = nameW / 168; // 0.44357
  const nameH = 40 * nameScale; // 17.74
  const nameX = panelX + (panelW - nameW) / 2; // 62.74
  const nameY = panelY + (panelH - nameH) / 2; // 112.13

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={effectiveLabel}
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        accessible={false}
      >
        {/* Clapperboard body */}
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

        {/* "A VUE" Wordmark inside the panel */}
        <G transform={`translate(${nameX}, ${nameY}) scale(${nameScale})`}>
          <G
            stroke={nameColor}
            strokeWidth={6}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            strokeMiterlimit={1.5}
          >
            {WORDMARK_PATHS.map((item) => (
              <Path
                key={item.id}
                d={item.d}
                transform={item.transform}
              />
            ))}
          </G>
        </G>

        {/* Clapper lid with stripes (raised -24deg around 46, 88) */}
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
      </Svg>
    </View>
  );
};

