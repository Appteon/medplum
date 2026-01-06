// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Paper, Text, Group, Alert, Progress, List } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { IconUpload, IconFile, IconCheck, IconX, IconArrowLeft, IconAlertCircle } from '@tabler/icons-react';
import '@mantine/dropzone/styles.css';

interface UploadResult {
  success: boolean;
  message: string;
  appointmentsCreated?: number;
  errors?: string[];
}

export function UploadAppointmentsPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileDrop = useCallback((files: File[]) => {
    if (files.length > 0) {
      const selectedFile = files[0];
      // Validate file extension
      if (!selectedFile.name.endsWith('.tsv') && !selectedFile.name.endsWith('.txt')) {
        setResult({
          success: false,
          message: 'Please upload a TSV file (.tsv or .txt)',
        });
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  }, []);

  const handleUpload = async (): Promise<void> => {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setResult(null);

    try {
      // Read the file content
      const content = await file.text();
      setUploadProgress(20);

      // Send to the backend API
      const response = await medplum.post('integrations/appointments/upload', {
        content,
        filename: file.name,
      });

      setUploadProgress(100);

      setResult({
        success: true,
        message: `Successfully processed ${response.appointmentsCreated || 0} appointments`,
        appointmentsCreated: response.appointmentsCreated,
        errors: response.errors,
      });
    } catch (error: any) {
      console.error('Upload failed:', error);
      setResult({
        success: false,
        message: error.message || 'Failed to upload appointments',
        errors: [error.message || 'Unknown error occurred'],
      });
    } finally {
      setUploading(false);
    }
  };

  const handleReset = (): void => {
    setFile(null);
    setResult(null);
    setUploadProgress(0);
  };

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Please sign in to upload appointments.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate('/')?.catch(console.error)}
          >
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Upload Appointments</h1>
            <p className="text-muted-foreground">Upload a TSV file to import appointments into the system</p>
          </div>
        </div>

        {/* Upload Card */}
        <Paper className="emr-card p-6">
          {/* File Format Info */}
          <Alert icon={<IconAlertCircle size={16} />} title="File Format" color="blue" mb="lg">
            <Text size="sm">
              Upload a TSV (Tab-Separated Values) file with the following columns:
            </Text>
            <List size="sm" mt="xs">
              <List.Item>PatientPracticeGuid, AppointmentGuid, ProviderGuid, FacilityGuid</List.Item>
              <List.Item>StartDateTime, EndDateTime, AppointmentStatus, AppointmentType</List.Item>
              <List.Item>ChiefComplaint, RoomLocation, InsuranceCoverageType</List.Item>
            </List>
          </Alert>

          {/* Dropzone */}
          {!result?.success && (
            <Dropzone
              onDrop={handleFileDrop}
              accept={{
                'text/tab-separated-values': ['.tsv'],
                'text/plain': ['.txt'],
              }}
              maxSize={10 * 1024 * 1024} // 10MB
              disabled={uploading}
              className="mb-6"
            >
              <Group justify="center" gap="xl" mih={180} style={{ pointerEvents: 'none' }}>
                <Dropzone.Accept>
                  <IconCheck size={52} className="text-green-500" />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconX size={52} className="text-red-500" />
                </Dropzone.Reject>
                <Dropzone.Idle>
                  <IconUpload size={52} className="text-muted-foreground" />
                </Dropzone.Idle>

                <div className="text-center">
                  <Text size="xl" inline>
                    Drag a TSV file here or click to browse
                  </Text>
                  <Text size="sm" c="dimmed" inline mt={7}>
                    File should not exceed 10MB
                  </Text>
                </div>
              </Group>
            </Dropzone>
          )}

          {/* Selected File */}
          {file && !result?.success && (
            <Paper withBorder p="md" mb="lg" className="bg-muted">
              <Group>
                <IconFile size={24} />
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {file.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {(file.size / 1024).toFixed(2)} KB
                  </Text>
                </div>
                <Button variant="subtle" color="red" size="xs" onClick={handleReset}>
                  Remove
                </Button>
              </Group>
            </Paper>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div className="mb-6">
              <Text size="sm" mb="xs">
                Uploading and processing...
              </Text>
              <Progress value={uploadProgress} animated />
            </div>
          )}

          {/* Result */}
          {result && (
            <Alert
              icon={result.success ? <IconCheck size={16} /> : <IconX size={16} />}
              title={result.success ? 'Upload Successful' : 'Upload Failed'}
              color={result.success ? 'green' : 'red'}
              mb="lg"
            >
              <Text size="sm">{result.message}</Text>
              {result.errors && result.errors.length > 0 && (
                <List size="sm" mt="xs">
                  {result.errors.slice(0, 5).map((error, index) => (
                    <List.Item key={index}>{error}</List.Item>
                  ))}
                  {result.errors.length > 5 && (
                    <List.Item>...and {result.errors.length - 5} more errors</List.Item>
                  )}
                </List>
              )}
            </Alert>
          )}

          {/* Actions */}
          <Group justify="flex-end">
            {result?.success ? (
              <>
                <Button variant="outline" onClick={handleReset}>
                  Upload Another File
                </Button>
                <Button onClick={() => navigate('/appointments')?.catch(console.error)}>
                  View Appointments
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => navigate('/')?.catch(console.error)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  loading={uploading}
                  leftSection={<IconUpload size={16} />}
                >
                  Upload & Process
                </Button>
              </>
            )}
          </Group>
        </Paper>
      </div>
    </div>
  );
}
