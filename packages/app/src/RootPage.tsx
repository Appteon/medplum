// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { getAppName, Logo, SignInForm, useMedplum, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { getConfig, isRegisterEnabled } from './utils/config';
import {
  IconCalendar,
  IconUpload,
  IconStethoscope,
  IconLink,
} from '@tabler/icons-react';
import { AuditActions } from './appteonComponents/helpers/auditLogger';

interface TileProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  color: string;
}

function Tile({ icon, title, description, href, color }: TileProps): JSX.Element {
  const navigate = useNavigate();
  const medplum = useMedplum();

  const handleClick = () => {
    // Log audit event for tile navigation
    AuditActions.tileNavigation(medplum, title, href);
    navigate(href)?.catch(console.error);
  };

  return (
    <div
      className="emr-card p-6 cursor-pointer hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
      onClick={handleClick}
    >
      <div className={`w-14 h-14 rounded-lg flex items-center justify-center mb-4 ${color}`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function isDoctor(profile: any): boolean {
  // Doctors are identified as Practitioners
  return profile?.resourceType === 'Practitioner';
}

function isFrontDesk(profile: any, accessPolicyName?: string): boolean {
  // Front desk users are identified by having the FrontDesk access policy
  // or by having a specific identifier/tag
  if (accessPolicyName?.toLowerCase().includes('front desk') || accessPolicyName?.toLowerCase().includes('frontdesk')) {
    return true;
  }
  // Check if the profile has a front desk identifier
  if (profile?.identifier) {
    for (const id of profile.identifier) {
      if (id.system === 'role' && id.value === 'front-desk') {
        return true;
      }
    }
  }
  return false;
}

export function RootPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();
  const navigate = useNavigate();
  const config = getConfig();

  // If user is not logged in, show the sign-in form
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
      </div>
    );
  }

  // Get the access policy name to determine role
  const accessPolicy = medplum.getAccessPolicy();
  const accessPolicyName = accessPolicy?.name;

  // Determine user role
  const isUserDoctor = isDoctor(profile);
  const isUserFrontDesk = isFrontDesk(profile, accessPolicyName);

  // Doctor tiles
  const doctorTiles: TileProps[] = [
    {
      icon: <IconCalendar size={28} className="text-white" />,
      title: 'View Appointments',
      description: 'View and manage patient appointments',
      href: '/appointments',
      color: 'bg-blue-500',
    },
    {
      icon: <IconUpload size={28} className="text-white" />,
      title: 'Upload Appointments',
      description: 'Upload appointment data from TSV files',
      href: '/appointments/upload',
      color: 'bg-green-500',
    },
    {
      icon: <IconStethoscope size={28} className="text-white" />,
      title: 'Clinical Review',
      description: 'Review clinical notes and patient records',
      href: '/review',
      color: 'bg-purple-500',
    },
  ];

  // Front desk tiles (subset of doctor tiles)
  const frontDeskTiles: TileProps[] = [
    {
      icon: <IconCalendar size={28} className="text-white" />,
      title: 'View Appointments',
      description: 'View and manage patient appointments',
      href: '/appointments',
      color: 'bg-blue-500',
    },
    {
      icon: <IconUpload size={28} className="text-white" />,
      title: 'Upload Appointments',
      description: 'Upload appointment data from TSV files',
      href: '/appointments/upload',
      color: 'bg-green-500',
    },
  ];

  // Super admin tiles
  const superAdminTiles: TileProps[] = [
    {
      icon: <IconLink size={28} className="text-white" />,
      title: 'Practitioner Linking',
      description: 'Link EHR practitioners and manage patient assignments',
      href: '/admin/practitioner-linking',
      color: 'bg-orange-500',
    },
  ];

  // Determine which tiles to show
  const baseTiles = isUserFrontDesk ? frontDeskTiles : doctorTiles;
  const isSuperAdmin = medplum.isSuperAdmin();
  const tiles = isSuperAdmin ? [...baseTiles, ...superAdminTiles] : baseTiles;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Welcome, {profile.name?.[0]?.given?.[0] || 'User'}
          </h1>
          <p className="text-muted-foreground">
            {isUserFrontDesk ? 'Front Desk Portal' : isUserDoctor ? 'Physician Portal' : 'User Portal'}
          </p>
        </div>

        {/* Tiles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tiles.map((tile, index) => (
            <Tile key={index} {...tile} />
          ))}
        </div>
      </div>
    </div>
  );
}
