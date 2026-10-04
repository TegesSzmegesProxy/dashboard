import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import {
  GitHubAppClient,
  GitHubError,
} from '../../infrastructure/github/github-app.client.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  BindRepositoryDto,
  LinkGitHubInstallationDto,
} from './source-repository.dto.js';
import {
  GitHubInstallationDocument,
  GitHubInstallationView,
  RepositorySource,
  TenantRepositoryDocument,
  TenantRepositoryView,
} from './source-repository.types.js';

@Injectable()
export class SourceRepositoriesService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly github: GitHubAppClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      // An installation belongs to exactly one organization.
      this.installations.createIndex({ installationId: 1 }, { unique: true }),
      this.installations.createIndex({ organizationId: 1, installationId: 1 }),
      this.repositories.createIndex(
        { organizationId: 1, tenantId: 1 },
        { unique: true },
      ),
    ]);
  }

  async linkInstallation(
    organizationId: string,
    dto: LinkGitHubInstallationDto,
    actorSubject: string,
  ): Promise<GitHubInstallationView> {
    const organizationObjectId = objectId(organizationId);
    const existing = await this.installations.findOne({
      installationId: dto.installationId,
    });
    if (existing) {
      if (!existing.organizationId.equals(organizationObjectId)) {
        throw new ConflictException('Installation is already linked');
      }
      return this.toInstallationView(existing);
    }
    const { accountLogin } = await this.callGitHub(() =>
      this.github.verifyUserInstallation(dto.code, dto.installationId),
    );
    try {
      return await this.mongo.transaction(async (session) => {
        const document: GitHubInstallationDocument = {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          installationId: dto.installationId,
          accountLogin,
          linkedBy: actorSubject,
          linkedAt: new Date(),
        };
        await this.installations.insertOne(document, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            actorSubject,
            action: 'github-installation.linked',
            targetType: 'githubInstallation',
            targetId: String(dto.installationId),
            metadata: { accountLogin },
          },
          session,
        );
        return this.toInstallationView(document);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Installation is already linked');
      }
      throw error;
    }
  }

  async listInstallations(
    organizationId: string,
  ): Promise<GitHubInstallationView[]> {
    const documents = await this.installations
      .find({ organizationId: objectId(organizationId) })
      .sort({ installationId: 1 })
      .limit(100)
      .toArray();
    return documents.map((document) => this.toInstallationView(document));
  }

  async unlinkInstallation(
    organizationId: string,
    installationId: number,
    actorSubject: string,
  ): Promise<void> {
    await this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const result = await this.installations.deleteOne(
        { organizationId: organizationObjectId, installationId },
        { session },
      );
      if (result.deletedCount === 0) {
        throw new NotFoundException('Installation not found');
      }
      const unbound = await this.repositories.deleteMany(
        { organizationId: organizationObjectId, installationId },
        { session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'github-installation.unlinked',
          targetType: 'githubInstallation',
          targetId: String(installationId),
          metadata: { unboundRepositories: String(unbound.deletedCount) },
        },
        session,
      );
    });
  }

  async bindRepository(
    organizationId: string,
    tenantId: string,
    dto: BindRepositoryDto,
    actorSubject: string,
  ): Promise<TenantRepositoryView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    await this.assertTenant(organizationObjectId, tenantObjectId);
    await this.assertInstallationLinked(
      organizationObjectId,
      dto.installationId,
    );
    const repository = await this.callGitHub(() =>
      this.github.getRepository(dto.installationId, dto.owner, dto.name),
    );
    return this.mongo.transaction(async (session) => {
      // Re-check inside the transaction in case the link was removed.
      await this.assertInstallationLinked(
        organizationObjectId,
        dto.installationId,
        session,
      );
      const now = new Date();
      const binding = await this.repositories.findOneAndUpdate(
        { organizationId: organizationObjectId, tenantId: tenantObjectId },
        {
          $set: {
            provider: 'github',
            installationId: dto.installationId,
            repositoryId: repository.id,
            owner: repository.owner,
            name: repository.name,
            fullName: repository.fullName,
            private: repository.private,
            boundBy: actorSubject,
            boundAt: now,
          },
          $setOnInsert: {
            _id: new ObjectId(),
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
          },
        },
        { upsert: true, returnDocument: 'after', session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'tenant-repository.bound',
          targetType: 'tenantRepository',
          targetId: tenantObjectId.toHexString(),
          metadata: {
            repository: repository.fullName,
            repositoryId: String(repository.id),
          },
        },
        session,
      );
      return this.toRepositoryView(binding!);
    });
  }

  async getRepository(
    organizationId: string,
    tenantId: string,
  ): Promise<TenantRepositoryView> {
    const binding = await this.repositories.findOne({
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    if (!binding) throw new NotFoundException('No repository is bound');
    return this.toRepositoryView(binding);
  }

  async unbindRepository(
    organizationId: string,
    tenantId: string,
    actorSubject: string,
  ): Promise<void> {
    await this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const tenantObjectId = objectId(tenantId);
      const result = await this.repositories.deleteOne(
        { organizationId: organizationObjectId, tenantId: tenantObjectId },
        { session },
      );
      if (result.deletedCount === 0) {
        throw new NotFoundException('No repository is bound');
      }
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'tenant-repository.unbound',
          targetType: 'tenantRepository',
          targetId: tenantObjectId.toHexString(),
        },
        session,
      );
    });
  }

  /** Current binding, only while its installation is still linked. */
  async findSource(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<RepositorySource | null> {
    const binding = await this.repositories.findOne({
      organizationId,
      tenantId,
    });
    if (!binding) return null;
    const linked = await this.installations.countDocuments({
      organizationId,
      installationId: binding.installationId,
    });
    if (linked === 0) return null;
    return {
      installationId: binding.installationId,
      repositoryId: binding.repositoryId,
      fullName: binding.fullName,
    };
  }

  /**
   * The bound repository and the commit at the head of its default branch,
   * for an analysis started from the dashboard. Null when nothing is bound.
   */
  async resolveHead(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<{ source: RepositorySource; commitSha: string } | null> {
    const source = await this.findSource(organizationId, tenantId);
    if (!source) return null;
    const commitSha = await this.callGitHub(() =>
      this.github.getHeadCommit(source.installationId, source.repositoryId),
    );
    return { source, commitSha };
  }

  private async assertTenant(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<void> {
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationId,
      tenantId,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  private async assertInstallationLinked(
    organizationId: ObjectId,
    installationId: number,
    session?: ClientSession,
  ): Promise<void> {
    const linked = await this.installations.countDocuments(
      { organizationId, installationId },
      { session },
    );
    if (linked === 0) {
      throw new UnprocessableEntityException(
        'Installation is not linked to this organization',
      );
    }
  }

  private async callGitHub<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      throw this.toHttpError(error);
    }
  }

  private toHttpError(error: GitHubError): HttpException {
    switch (error.code) {
      case 'NOT_CONFIGURED':
        return new ServiceUnavailableException(error.message);
      case 'OAUTH_FAILED':
      case 'INSTALLATION_NOT_ACCESSIBLE':
        return new ForbiddenException(error.message);
      case 'REPOSITORY_NOT_ACCESSIBLE':
      case 'REVISION_NOT_FOUND':
        return new UnprocessableEntityException(error.message);
      default:
        return new BadGatewayException(error.message);
    }
  }

  private toInstallationView(
    document: GitHubInstallationDocument,
  ): GitHubInstallationView {
    return {
      installationId: document.installationId,
      accountLogin: document.accountLogin,
      linkedBy: document.linkedBy,
      linkedAt: document.linkedAt,
    };
  }

  private toRepositoryView(
    document: TenantRepositoryDocument,
  ): TenantRepositoryView {
    return {
      tenantId: document.tenantId.toHexString(),
      provider: document.provider,
      installationId: document.installationId,
      repositoryId: document.repositoryId,
      fullName: document.fullName,
      private: document.private,
      boundBy: document.boundBy,
      boundAt: document.boundAt,
    };
  }

  private get installations() {
    return this.mongo.db.collection<GitHubInstallationDocument>(
      'githubInstallations',
    );
  }

  private get repositories() {
    return this.mongo.db.collection<TenantRepositoryDocument>(
      'tenantRepositories',
    );
  }
}
