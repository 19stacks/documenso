import { Trans } from '@lingui/react/macro';

import { Heading, Text } from '../components';

export interface TemplateDocumentRejectedProps {
  documentName: string;
  recipientName: string;
  rejectionReason?: string;
  documentUrl: string;
}

export function TemplateDocumentRejected({
  documentName,
  recipientName: signerName,
  rejectionReason,
}: TemplateDocumentRejectedProps) {
  return (
    <div className="mt-4">
      <Heading className="mb-4 text-center font-semibold text-2xl text-foreground">
        <Trans>Document Rejected</Trans>
      </Heading>

      <Text className="mb-4 text-base">
        <Trans>
          {signerName} has rejected the document "{documentName}".
        </Trans>
      </Text>

      {rejectionReason && (
        <Text className="mb-4 text-base text-muted-foreground">
          <Trans>Reason for rejection: {rejectionReason}</Trans>
        </Text>
      )}

      <Text className="mb-6 text-base">
        <Trans>The document owner has been notified. You can view the document status from your Wize dashboard.</Trans>
      </Text>
    </div>
  );
}
