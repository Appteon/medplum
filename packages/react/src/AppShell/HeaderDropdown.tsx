// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Menu } from '@mantine/core';
import { useMedplumContext } from '@medplum/react-hooks';
import { IconLogout } from '@tabler/icons-react';
import type { JSX } from 'react';

export interface HeaderDropdownProps {
  readonly version?: string;
}

export function HeaderDropdown(props: HeaderDropdownProps): JSX.Element {
  const context = useMedplumContext();
  const { medplum, navigate } = context;

  return (
    <>
      <Menu.Item
        leftSection={<IconLogout size={14} stroke={1.5} />}
        onClick={async () => {
          await medplum.signOut();
          navigate('/signin');
        }}
      >
        Sign out
      </Menu.Item>
    </>
  );
}
