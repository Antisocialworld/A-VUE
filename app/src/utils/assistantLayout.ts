export const ASSISTANT_PANEL_MIN_WIDTH = 900;
export const ASSISTANT_PANEL_WIDTH = 420;

/** Pure rule: wide web uses the side panel; narrow web and native keep the full screen. */
export function shouldUseAssistantPanel(platform: string, width: number): boolean {
  return platform === 'web' && width >= ASSISTANT_PANEL_MIN_WIDTH;
}
