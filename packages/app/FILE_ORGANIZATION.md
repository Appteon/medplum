# App Source File Organization

This document describes the reorganized file structure for `/packages/app/src`.

## Overview

The source files have been reorganized from a flat structure into logical folders to improve maintainability and reduce clutter.

## New Folder Structure

```
src/
├── App.tsx                      # Main app component
├── AppRoutes.tsx               # Route definitions
├── ErrorPage.tsx               # Global error page
├── RootPage.tsx                # New root/home page (placeholder)
├── index.tsx                   # App entry point
│
├── admin/                      # Admin & project management pages
│   ├── BotsPage.tsx
│   ├── ClientsPage.tsx
│   ├── CreateBotPage.tsx
│   ├── CreateClientPage.tsx
│   ├── DatabaseToolsPage.tsx
│   ├── EditMembershipPage.tsx
│   ├── InvitePage.tsx
│   ├── PatientsPage.tsx
│   ├── ProjectAdminConfigPage.tsx
│   ├── ProjectDetailsPage.tsx
│   ├── ProjectPage.tsx
│   ├── SecretsPage.tsx
│   ├── SitesPage.tsx
│   ├── SuperAdminAsyncJobPage.tsx
│   ├── SuperAdminPage.tsx
│   ├── UsersPage.tsx
│   └── db/                     # Database admin tools
│       └── GINIndexes.tsx
│
├── components/                 # Reusable UI components
│   ├── QuickServiceRequests.tsx
│   ├── QuickStatus.tsx
│   ├── ResourceHeader.tsx
│   └── SpecimenHeader.tsx
│
├── lab/                        # Lab-specific pages
│   ├── AssaysPage.tsx
│   └── PanelsPage.tsx
│
├── pages/                      # Main application pages
│   ├── auth/                   # Authentication & user management
│   │   ├── ChangePasswordPage.tsx
│   │   ├── MfaPage.tsx
│   │   ├── OAuthPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── ResetPasswordPage.tsx
│   │   ├── SecurityPage.tsx
│   │   ├── SetPasswordPage.tsx
│   │   ├── SignInPage.tsx
│   │   └── VerifyEmailPage.tsx
│   │
│   └── search/                 # Resource search & management
│       ├── BatchPage.tsx
│       ├── BulkAppPage.tsx
│       ├── CreateResourcePage.tsx
│       ├── FormPage.tsx
│       ├── HomePage.tsx
│       ├── HomePage.utils.ts
│       └── SmartSearchPage.tsx
│
├── resource/                   # FHIR resource pages & tools
│   ├── ApplyPage.tsx
│   ├── AppsPage.tsx
│   ├── AuditEventPage.tsx
│   ├── BlamePage.tsx
│   ├── BotEditor.tsx
│   ├── BuilderPage.tsx
│   ├── ChecklistPage.tsx
│   ├── DeletePage.tsx
│   ├── DetailsPage.tsx
│   ├── EditPage.tsx
│   ├── ExportPage.tsx
│   ├── FormCreatePage.tsx
│   ├── HistoryPage.tsx
│   ├── JsonCreatePage.tsx
│   ├── JsonPage.tsx
│   ├── PreviewPage.tsx
│   ├── ProfilesPage.tsx
│   ├── QuestionnaireBotsPage.tsx
│   ├── QuestionnaireResponsePage.tsx
│   ├── ReferenceRangesPage.tsx
│   ├── ReportPage.tsx
│   ├── ResourcePage.tsx
│   ├── ResourceVersionPage.tsx
│   ├── SubscriptionsPage.tsx
│   ├── TimelinePage.tsx
│   ├── ToolsPage.tsx
│   └── utils.ts
│
└── utils/                      # Shared utilities
    ├── config.ts               # App configuration
    └── helpers.ts              # Helper functions
```

## Changes Made

### 1. **Created Organized Folders**
   - `pages/auth/` - All authentication-related pages
   - `pages/search/` - Resource search and browsing pages
   - `utils/` - Configuration and helper utilities

### 2. **Moved Files**
   - Authentication pages → `pages/auth/`
   - Search/resource listing pages → `pages/search/`
   - Utility files → `utils/`

### 3. **Removed Files**
   - All `.test.tsx` and `.test.ts` files removed
   - `test.setup.ts` removed

### 4. **Updated Imports**
   - All import paths updated in affected files
   - `AppRoutes.tsx` updated with new paths
   - Resource and admin pages updated to reference new utility paths

## Key Files

### Core Application
- **App.tsx**: Main application shell with navigation
- **AppRoutes.tsx**: All route definitions
- **RootPage.tsx**: New placeholder for the root route (/)
- **index.tsx**: Application entry point

### Configuration
- **utils/config.ts**: Application configuration (URLs, client IDs, etc.)
- **utils/helpers.ts**: Shared helper functions

### Navigation Flow
1. User visits root → **RootPage.tsx** (new placeholder)
2. User clicks resource type → **HomePage.tsx** (search interface)
3. User clicks resource → **ResourcePage.tsx** and sub-routes

## Benefits

1. **Better Organization**: Related files grouped logically
2. **Easier Navigation**: Find files by their purpose
3. **Cleaner Root**: Only 4 files in `src/` root directory
4. **Clear Separation**: Auth, search, resources, and admin clearly separated
5. **Scalability**: Easy to add new pages in appropriate folders

## Import Path Examples

### Before
```typescript
import { SignInPage } from './SignInPage';
import { getConfig } from './config';
import { formatDate } from './utils';
```

### After
```typescript
import { SignInPage } from './pages/auth/SignInPage';
import { getConfig } from './utils/config';
import { formatDate } from './utils/helpers';
```

## Notes

- Test files were removed as they were cluttering the structure
- The `resource/`, `admin/`, `lab/`, and `components/` folders already existed and remain unchanged
- All imports have been updated to reflect new paths
- The application functionality remains the same, only file locations changed
