import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Db } from './db/db.service';
import { AllExceptionsFilter } from './common/errors';
import { AuthGuard } from './common/auth';
import { AuditService } from './audit/audit.service';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminController } from './admin/admin.controller';
import { LookupsController } from './admin/lookups.controller';
import { TemplatesController, TemplatesService } from './templates/templates.service';
import { WorkflowService } from './workflow/workflow.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { StorageService } from './attachments/storage.service';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController } from './notifications/notifications.controller';
import { QueueService } from './notifications/queue.service';
import { MailService } from './notifications/mail.service';
import { PdfService } from './pdf/pdf.service';
import { VerifyController } from './verify/verify.controller';
import { ReportsController } from './reports/reports.controller';
import { HealthController } from './health.controller';

const providers = [
  Db, AuditService, AuthService, TemplatesService, WorkflowService, CasesService, DocumentsService,
  StorageService, NotificationsService, QueueService, MailService, PdfService,
  { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter },
];

/** One global module: the services are small and share the same database, so feature wiring stays flat. */
@Global()
@Module({
  controllers: [
    HealthController, AuthController, AdminController, LookupsController, TemplatesController, CasesController, DocumentsController,
    AttachmentsController, NotificationsController, AuditController, VerifyController, ReportsController,
  ],
  providers,
  exports: providers.filter((p) => typeof p === 'function') as any,
})
export class AppModule {}
