import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  CodeInput,
  EmptyState,
  FormError,
  Logo,
  PasswordField,
  QrCodeView,
  ScreenShell,
  SeatMap,
  TextField,
  TicketIcon,
} from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';

export interface ComponentGalleryScreenProps {
  onBack: () => void;
}

export const ComponentGalleryScreen: React.FC<ComponentGalleryScreenProps> = ({ onBack }) => {
  const { colors, spacing, radius, typography, mode, toggleTheme } = useTheme();

  // Interactive gallery states
  const [textFieldValue, setTextFieldValue] = useState('Sample text value');
  const [passwordValue, setPasswordValue] = useState('Secret123!');
  const [codeValue, setCodeValue] = useState('123456');

  const themeToggleText =
    mode === 'dark' ? STRINGS.accessibility.themeToggleLight : STRINGS.accessibility.themeToggleDark;

  const renderSectionHeader = (title: string) => (
    <View
      style={[
        styles.sectionHeaderContainer,
        {
          borderBottomColor: colors.outline_variant,
          marginTop: spacing.xl,
          marginBottom: spacing.md,
          paddingBottom: spacing.xs,
        },
      ]}
    >
      <Text
        allowFontScaling
        accessibilityRole="header"
        style={[
          styles.sectionHeader,
          {
            color: colors.primary_text,
            fontFamily: typography.titleLarge.fontFamily,
            fontSize: typography.titleLarge.fontSize,
            fontWeight: typography.titleLarge.fontWeight,
          },
        ]}
      >
        {title}
      </Text>
    </View>
  );

  const renderStateLabel = (label: string) => (
    <Text
      allowFontScaling
      style={[
        styles.stateLabel,
        {
          color: colors.on_surface_variant,
          fontFamily: typography.labelMedium.fontFamily,
          fontSize: typography.labelMedium.fontSize,
          marginBottom: spacing.xs,
          marginTop: spacing.sm,
        },
      ]}
    >
      {label}
    </Text>
  );

  const headerRight = (
    <Button
      title={mode === 'dark' ? '☀️ Light' : '🌙 Dark'}
      onPress={toggleTheme}
      variant="text"
      accessibilityLabel={themeToggleText}
      style={styles.themeToggleBtn}
    />
  );

  return (
    <ScreenShell
      title={STRINGS.gallery.title}
      onBack={onBack}
      headerRight={headerRight}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
    >
      <Text
        allowFontScaling
        style={[
          styles.gallerySubtitle,
          {
            color: colors.on_surface_variant,
            fontFamily: typography.bodyMedium.fontFamily,
            fontSize: typography.bodyMedium.fontSize,
            marginBottom: spacing.md,
          },
        ]}
      >
        {STRINGS.gallery.subtitle} (Active theme: {mode})
      </Text>

      {/* ---------------- 1. LOGO LOCKUP ---------------- */}
      {renderSectionHeader('Logo Lockup (Brand Artwork)')}

      {renderStateLabel(`Current Theme Lockup (${mode})`)}
      <View style={styles.centerItem}>
        <Logo size={120} />
      </View>

      {renderStateLabel('Light Theme Lockup (Forced)')}
      <View style={[styles.centerItem, { backgroundColor: '#FFF4F1', padding: spacing.sm, borderRadius: radius.md }]}>
        <Logo size={100} theme="light" />
      </View>

      {renderStateLabel('Dark Theme Lockup (Forced)')}
      <View style={[styles.centerItem, { backgroundColor: '#1A110F', padding: spacing.sm, borderRadius: radius.md }]}>
        <Logo size={100} theme="dark" />
      </View>

      {/* ---------------- 2. BUTTONS ---------------- */}
      {renderSectionHeader(STRINGS.gallery.buttonsSection)}

      {/* Primary Button States */}
      {renderStateLabel('Primary Button — Default')}
      <Button title="Primary Default" onPress={() => {}} variant="primary" />

      {renderStateLabel('Primary Button — Loading')}
      <Button title="Primary Loading" onPress={() => {}} variant="primary" loading />

      {renderStateLabel('Primary Button — Disabled')}
      <Button title="Primary Disabled" onPress={() => {}} variant="primary" disabled />

      {/* Secondary Button States */}
      {renderStateLabel('Secondary Button — Default')}
      <Button title="Secondary Default" onPress={() => {}} variant="secondary" />

      {renderStateLabel('Secondary Button — Loading')}
      <Button title="Secondary Loading" onPress={() => {}} variant="secondary" loading />

      {renderStateLabel('Secondary Button — Disabled')}
      <Button title="Secondary Disabled" onPress={() => {}} variant="secondary" disabled />

      {/* Text Button States */}
      {renderStateLabel('Text Button — Default')}
      <Button title="Text Default" onPress={() => {}} variant="text" />

      {renderStateLabel('Text Button — Disabled')}
      <Button title="Text Disabled" onPress={() => {}} variant="text" disabled />

      {/* Outlined Button States */}
      {renderStateLabel('Outlined Button — Default')}
      <Button title="Outlined Default" onPress={() => {}} variant="outlined" />

      {renderStateLabel('Outlined Button — Disabled')}
      <Button title="Outlined Disabled" onPress={() => {}} variant="outlined" disabled />

      {/* ---------------- 3. TEXT FIELDS ---------------- */}
      {renderSectionHeader(STRINGS.gallery.textFieldsSection)}

      {renderStateLabel('TextField — Default (Empty)')}
      <TextField
        label="Email address"
        placeholder="name@example.com"
        value=""
        onChangeText={() => {}}
      />

      {renderStateLabel('TextField — Filled')}
      <TextField
        label="Filled Input"
        placeholder="Placeholder"
        value={textFieldValue}
        onChangeText={setTextFieldValue}
      />

      {renderStateLabel('TextField — Error State')}
      <TextField
        label="Invalid Field"
        placeholder="Type here"
        value="invalid-value"
        onChangeText={() => {}}
        error="This is an accessible error message"
      />

      {renderStateLabel('TextField — Disabled State')}
      <TextField
        label="Disabled Field"
        placeholder="Cannot edit"
        value="Read-only data"
        onChangeText={() => {}}
        disabled
      />

      {/* ---------------- 4. PASSWORD FIELDS & CHECKLIST ---------------- */}
      {renderSectionHeader(STRINGS.gallery.passwordFieldsSection)}

      {renderStateLabel('PasswordField — Standard (Sign In style, no checklist)')}
      <PasswordField
        label="Sign In Password"
        value={passwordValue}
        onChangeText={setPasswordValue}
        showChecklist={false}
      />

      {renderStateLabel('PasswordField — Live Checklist (Partial valid)')}
      <PasswordField
        label="Sign Up Password"
        value="pass"
        onChangeText={() => {}}
        showChecklist={true}
      />

      {renderStateLabel('PasswordField — Live Checklist (Fully valid)')}
      <PasswordField
        label="Strong Password"
        value="StrongPass123!"
        onChangeText={() => {}}
        showChecklist={true}
      />

      {/* ---------------- 5. CODE INPUT ---------------- */}
      {renderSectionHeader(STRINGS.gallery.codeInputsSection)}

      {renderStateLabel('CodeInput — Empty')}
      <CodeInput value="" onChangeText={() => {}} />

      {renderStateLabel('CodeInput — Partial (3 digits entered)')}
      <CodeInput value="456" onChangeText={() => {}} />

      {renderStateLabel('CodeInput — Complete (Interactive)')}
      <CodeInput value={codeValue} onChangeText={setCodeValue} />

      {renderStateLabel('CodeInput — Error State')}
      <CodeInput
        value="999999"
        onChangeText={() => {}}
        error="Incorrect code. 4 attempts remaining."
      />

      {renderStateLabel('CodeInput — Disabled')}
      <CodeInput value="123456" onChangeText={() => {}} disabled />

      {/* ---------------- 6. FORM ERRORS & ALERTS ---------------- */}
      {renderSectionHeader(STRINGS.gallery.formErrorsSection)}

      {renderStateLabel('FormError Banner')}
      <FormError message="Invalid credentials or network connection issue occurred." />

      {/* ---------------- 7. EMPTY STATE ---------------- */}
      {renderSectionHeader('EmptyState')}

      {renderStateLabel('EmptyState — Default')}
      <EmptyState
        title="No Movies Scheduled"
        message="There are currently no movies or showtimes available. Please check back soon."
        actionTitle="Refresh"
        onActionPress={() => {}}
      />

      {renderStateLabel('EmptyState — With Watermark')}
      <EmptyState
        title="No Movies Scheduled"
        message="There are currently no movies or showtimes available. Please check back soon."
        actionTitle="Refresh"
        onActionPress={() => {}}
        showWatermark
      />

      {renderSectionHeader('Seat Map & QR Components')}
      {renderStateLabel('Interactive Seat Map')}
      <View style={{ height: 260, borderWidth: 1, borderColor: colors.outline_variant, borderRadius: radius.md, overflow: 'hidden' }}>
        <SeatMap
          showtimeId="gallery-demo-showtime"
          selectedSeatIds={[]}
          onSelectionChange={() => {}}
          onToast={() => {}}
        />
      </View>

      {renderStateLabel('Deterministic Pure-JS Ticket QR Code')}
      <View style={[styles.centerItem, { padding: spacing.md }]}>
        <QrCodeView value="avue_gallery_qr_sample_reference_token_128_bit" size={160} />
      </View>

      {renderSectionHeader('Vector Icons')}
      {renderStateLabel('TicketIcon: Primary On-Primary (Header / My Tickets Pill) & Outlined Muted')}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm }}>
        <View style={{ backgroundColor: colors.primary, padding: spacing.sm, borderRadius: radius.full }}>
          <TicketIcon size={20} color={colors.on_primary} />
        </View>
        <View style={{ borderWidth: 1, borderColor: colors.outline_variant, padding: spacing.sm, borderRadius: radius.full }}>
          <TicketIcon size={20} color={colors.on_surface_variant} />
        </View>
      </View>

      <Button
        title={STRINGS.gallery.backToAuth}
        onPress={onBack}
        variant="secondary"
        style={{ marginTop: spacing.xl }}
      />
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  gallerySubtitle: {
    letterSpacing: -0.1,
  },
  sectionHeaderContainer: {
    borderBottomWidth: 1,
  },
  sectionHeader: {
    letterSpacing: -0.2,
  },
  stateLabel: {
    letterSpacing: -0.05,
  },
  themeToggleBtn: {
    minHeight: 44,
    paddingHorizontal: 8,
  },
  centerItem: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
});
