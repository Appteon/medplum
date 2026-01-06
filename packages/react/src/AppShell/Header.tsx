// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Group, AppShell as MantineAppShell, Menu, Text, UnstyledButton } from '@mantine/core';
import { formatHumanName } from '@medplum/core';
import type { HumanName } from '@medplum/fhirtypes';
import { useMedplumNavigate, useMedplumProfile } from '@medplum/react-hooks';
import { IconChevronDown, IconHome } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { ResourceAvatar } from '../ResourceAvatar/ResourceAvatar';
import classes from './Header.module.css';
import { HeaderDropdown } from './HeaderDropdown';

export interface HeaderProps {
  readonly pathname?: string;
  readonly searchParams?: URLSearchParams;
  readonly headerSearchDisabled?: boolean;
  readonly logo: ReactNode;
  readonly version?: string;
  readonly navbarOpen?: boolean;
  readonly navbarToggle: () => void;
  readonly notifications?: ReactNode;
}

export function Header(props: HeaderProps): JSX.Element {
  const profile = useMedplumProfile();
  const navigate = useMedplumNavigate();
  const [userMenuOpened, setUserMenuOpened] = useState(false);

  const showAppteonLogo = ['/', '/review', '/appointments', '/appointments/upload'].includes(
    props.pathname ?? ''
  );

  return (
    <MantineAppShell.Header style={{ zIndex: 101, backgroundColor: '#f8f9fa', display: 'flex', alignItems: 'center' }}>
      <Group justify="space-between" align="center" style={{ width: '100%' }} h="100%">
        {showAppteonLogo ? (
          <UnstyledButton
            className={classes.logoButton}
            aria-expanded={props.navbarOpen}
            aria-controls="navbar"
            onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', height: '40px' }}
          >
            <img
              src="/img/AppteonLogo.png"
              alt="Appteon Logo"
              style={{ height: '40px', width: 'auto', display: 'block', marginLeft: '16px' }}
            />
          </UnstyledButton>
        ) : (
          <UnstyledButton
            className={classes.logoButton}
            aria-expanded={props.navbarOpen}
            aria-controls="navbar"
            onClick={() => props.navbarToggle()}
            style={{ display: 'flex', alignItems: 'center', height: '40px' }}
          >
            {props.logo}
          </UnstyledButton>
        )}
        <Text size="xl" fw={700} style={{ color: 'var(--mantine-color-dark-7)', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          Medical AI Assistant
        </Text>
        <Group gap="lg" align="center">
          {props.notifications}
          {props.pathname === '/review' && (
            <UnstyledButton
              className={classes.homeButton}
              aria-label="Home"
              onClick={() => navigate('/')}
              title="Home"
              style={{ display: 'flex', alignItems: 'center', height: '40px', padding: '8px 12px', borderRadius: '8px' }}
            >
              <IconHome size={20} stroke={1.5} />
            </UnstyledButton>
          )}
          <Menu
            width={260}
            shadow="xl"
            position="bottom-end"
            transitionProps={{ transition: 'fade-down' }}
            opened={userMenuOpened}
            onClose={() => setUserMenuOpened(false)}
          >
            <Menu.Target>
              <UnstyledButton
                className={classes.user}
                aria-label="User menu"
                data-active={userMenuOpened || undefined}
                onClick={() => setUserMenuOpened((o) => !o)}
                style={{ display: 'flex', alignItems: 'center', height: '40px' }}
              >
                <Group gap={7} align="center" wrap="nowrap">
                  <ResourceAvatar value={profile} radius="xl" size={24} />
                  <Text size="sm" className={classes.userName}>
                    {formatHumanName(profile?.name?.[0] as HumanName)}
                  </Text>
                  <IconChevronDown size={12} stroke={1.5} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <HeaderDropdown version={props.version} />
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </MantineAppShell.Header>
  );
}
