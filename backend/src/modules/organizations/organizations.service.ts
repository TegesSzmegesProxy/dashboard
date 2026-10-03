import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './organization.dto.js';
import {
  MembershipDocument,
  OrganizationDocument,
  OrganizationView,
} from './organization.types.js';

@Injectable()
export class OrganizationsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.mongo.db
      .collection<OrganizationDocument>('organizations')
      .createIndex({ status: 1, name: 1 });
  }

  async create(
    dto: CreateOrganizationDto,
    actorSubject: string,
  ): Promise<OrganizationView> {
    return this.mongo.transaction(async (session) => {
      const now = new Date();
      const organization: OrganizationDocument = {
        _id: new ObjectId(),
        name: dto.name.trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await this.organizations.insertOne(organization, { session });
      await this.memberships.insertOne(
        {
          _id: new ObjectId(),
          organizationId: organization._id,
          subject: actorSubject,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await this.audit.append(
        {
          organizationId: organization._id,
          actorSubject,
          action: 'organization.created',
          targetType: 'organization',
          targetId: organization._id.toHexString(),
        },
        session,
      );
      return this.toView(organization, 'owner');
    });
  }

  async list(
    actorSubject: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<OrganizationView>> {
    const membershipFilter: {
      subject: string;
      _id?: { $gt: ObjectId };
    } = { subject: actorSubject };
    membershipFilter._id = afterCursor(pagination.cursor);
    if (!membershipFilter._id) delete membershipFilter._id;
    const memberships = await this.memberships
      .find(membershipFilter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    if (memberships.length === 0) {
      return { items: [], nextCursor: null };
    }
    const hasNextPage = memberships.length > pagination.limit;
    const pageMemberships = memberships.slice(0, pagination.limit);
    const organizations = await this.organizations
      .find({
        _id: { $in: pageMemberships.map((entry) => entry.organizationId) },
      })
      .toArray();
    const organizationsById = new Map(
      organizations.map((organization) => [
        organization._id.toHexString(),
        organization,
      ]),
    );
    const items = pageMemberships.flatMap((membership) => {
      const organization = organizationsById.get(
        membership.organizationId.toHexString(),
      );
      return organization ? [this.toView(organization, membership.role)] : [];
    });
    return {
      items,
      nextCursor: hasNextPage
        ? pageMemberships.at(-1)!._id.toHexString()
        : null,
    };
  }

  async get(
    organizationId: string,
    actorSubject: string,
  ): Promise<OrganizationView> {
    const id = objectId(organizationId);
    const [organization, membership] = await Promise.all([
      this.organizations.findOne({ _id: id }),
      this.memberships.findOne({ organizationId: id, subject: actorSubject }),
    ]);
    if (!organization || !membership) {
      throw new NotFoundException('Organization not found');
    }
    return this.toView(organization, membership.role);
  }

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
    actorSubject: string,
  ): Promise<OrganizationView> {
    if (dto.name === undefined) {
      throw new BadRequestException('At least one field must be updated');
    }
    return this.mongo.transaction(async (session) => {
      const id = objectId(organizationId);
      const changes: Partial<OrganizationDocument> = { updatedAt: new Date() };
      if (dto.name !== undefined) {
        changes.name = dto.name.trim();
      }
      const updated = await this.organizations.findOneAndUpdate(
        { _id: id },
        { $set: changes },
        { returnDocument: 'after', session },
      );
      if (!updated) {
        throw new NotFoundException('Organization not found');
      }
      await this.audit.append(
        {
          organizationId: id,
          actorSubject,
          action: 'organization.updated',
          targetType: 'organization',
          targetId: id.toHexString(),
        },
        session,
      );
      const membership = await this.memberships.findOne(
        { organizationId: id, subject: actorSubject },
        { session },
      );
      if (!membership) {
        throw new NotFoundException('Organization not found');
      }
      return this.toView(updated, membership.role);
    });
  }

  private get organizations() {
    return this.mongo.db.collection<OrganizationDocument>('organizations');
  }

  private get memberships() {
    return this.mongo.db.collection<MembershipDocument>('memberships');
  }

  private toView(
    document: OrganizationDocument,
    role: OrganizationView['role'],
  ): OrganizationView {
    return {
      id: document._id.toHexString(),
      name: document.name,
      status: document.status,
      role,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
