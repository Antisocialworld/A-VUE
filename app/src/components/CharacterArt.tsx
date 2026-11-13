import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

export interface CharacterArtProps {
  height?: number;
  width?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A VUE CharacterArt Component
 * Renders the character illustration frozen in the pose lifting the clapper lid (t = 45%).
 * Decorative: completely hidden from screen readers (accessible={false}, aria-hidden={true}).
 */
export const CharacterArt: React.FC<CharacterArtProps> = ({
  height = 155,
  width,
  style,
  testID,
}) => {
  const vbWidth = 65;
  const vbHeight = 155;
  const computedWidth = width !== undefined ? width : height * (vbWidth / vbHeight);

  return (
    <View
      testID={testID}
      accessible={false}
      aria-hidden={true}
      style={[
        {
          width: computedWidth,
          height,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Svg
        width={computedWidth}
        height={height}
        viewBox="-35 -145 65 155"
        fill="none"
        accessible={false}
        aria-hidden={true}
      >
        {/* Ground shadow */}
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
      </Svg>
    </View>
  );
};

