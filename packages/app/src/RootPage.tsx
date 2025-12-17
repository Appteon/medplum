// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Paper, Text, Title } from '@mantine/core';
import { getAppName, Logo, SignInForm, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { getConfig, isRegisterEnabled } from './utils/config';

export function RootPage(): JSX.Element {
  const profile = useMedplumProfile();
  const navigate = useNavigate();
  const config = getConfig();

  // If user is not logged in, show the sign-in form
  if (!profile) {
    return (
      <SignInForm
        onSuccess={() => navigate('/')?.catch(console.error)}
        onForgotPassword={() => navigate('/resetpassword')?.catch(console.error)}
        onRegister={isRegisterEnabled() ? () => navigate('/register')?.catch(console.error) : undefined}
        googleClientId={config.googleClientId}
      >
        <Logo size={32} />
        <Title order={3} py="lg">
          Sign in to {getAppName()}
        </Title>
      </SignInForm>
    );
  }

  // If user is logged in, show the placeholder
  return (
    <Paper shadow="xs" m="md" p="xl">
      <Text size="xl" fw={500}>
        Welcome to HealthAI
      </Text>
      <Text size="sm" c="dimmed" mt="md">
        This is a placeholder component. Add your custom content here.
      </Text>
    </Paper>
  );
}
