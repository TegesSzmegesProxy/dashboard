import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CreateMembershipDto,
  UpdateMembershipDto,
} from './organization.dto.js';
import { OrganizationRole } from './organization-role.js';
import { MembershipDocument, MembershipView } from './organization.types.js';

@Injectable()
export class MembershipsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { organizationId: 1, subject: 1 },
      { unique: true },
    );
  }

  find(
    organizationId: string,
    subject: string,
  ): Promise<MembershipDocument | null> {
    return this.collection.findOne({
      organizationId: objectId(organizationId),
      subject,
    });
  }

  async list(
    organizationId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<MembershipView>> {
    const filter: {
      organizationId: ObjectId;
      _id?: { $gt: ObjectId };
    } = { organizationId: objectId(organizationId) };
    filter._id = afterCursor(pagination.cursor);
    if (!filter._id) delete filter._id;
    const documents = await this.collection
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    return {
      items: pageDocuments.map((document) => this.toView(document)),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  async create(
    organizationId: string,
    dto: CreateMembershipDto,
    actorSubject: string,
  ): Promise<MembershipView> {
    try {
      return await this.mongo.transaction(async (session) => {
        const organizationObjectId = objectId(organizationId);
        const actor = await this.requireActor(
          organizationObjectId,
          actorSubject,
          session,
        );
        this.assertCanAssign(actor.role, dto.role);
        const now = new Date();
        const document: MembershipDocument = {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          subject: dto.subject.trim(),
          role: dto.role,
          createdAt: now,
          updatedAt: now,
        };
        await this.collection.insertOne(document, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            actorSubject,
            action: 'membership.created',
            targetType: 'membership',
            targetId: document._id.toHexString(),
            metadata: { role: document.role },
          },
          session,
        );
        return this.toView(document);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Membership already exists');
      }
      throw error;
    }
  }

  async update(
    organizationId: string,
    membershipId: string,
    dto: UpdateMembershipDto,
    actorSubject: string,
  ): Promise<MembershipView> {
    return this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const actor = await this.requireActor(
        organizationObjectId,
        actorSubject,
        session,
      );
      const target = await this.requireTarget(
        organizationObjectId,
        objectId(membershipId),
        session,
      );
      this.assertCanChange(actor.role, target.role, dto.role);
      await this.assertOwnerRemains(target, dto.role, session);
      const updated = await this.collection.findOneAndUpdate(
        { _id: target._id, organizationId: organizationObjectId },
        { $set: { role: dto.role, updatedAt: new Date() } },
        { returnDocument: 'after', session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'membership.updated',
          targetType: 'membership',
          targetId: target._id.toHexString(),
          metadata: { previousRole: target.role, role: dto.role },
        },
        session,
      );
      return this.toView(updated!);
    });
  }

  async remove(
    organizationId: string,
    membershipId: string,
    actorSubject: string,
  ): Promise<void> {
    await this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const actor = await this.requireActor(
        organizationObjectId,
        actorSubject,
        session,
      );
      const target = await this.requireTarget(
        organizationObjectId,
        objectId(membershipId),
        session,
      );
      this.assertCanChange(actor.role, target.role);
      await this.assertOwnerRemains(target, undefined, session);
      await this.collection.deleteOne(
        { _id: target._id, organizationId: organizationObjectId },
        { session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'membership.deleted',
          targetType: 'membership',
          targetId: target._id.toHexString(),
          metadata: { role: target.role },
        },
        session,
      );
    });
  }

  private get collection() {
    return this.mongo.db.collection<MembershipDocument>('memberships');
  }

  private async requireActor(
    organizationId: ObjectId,
    subject: string,
    session: ClientSession,
  ): Promise<MembershipDocument> {
    const actor = await this.collection.findOne(
      { organizationId, subject },
      { session },
    );
    if (!actor) {
      throw new ForbiddenException('Organization access denied');
    }
    return actor;
  }

  private async requireTarget(
    organizationId: ObjectId,
    membershipId: ObjectId,
    session: ClientSession,
  ): Promise<MembershipDocument> {
    const target = await this.collection.findOne(
      { _id: membershipId, organizationId },
      { session },
    );
    if (!target) {
      throw new NotFoundException('Membership not found');
    }
    return target;
  }

  private assertCanAssign(
    actorRole: OrganizationRole,
    assignedRole: OrganizationRole,
  ): void {
    if (actorRole !== 'owner' && assignedRole === 'owner') {
      throw new ForbiddenException('Only owners can grant owner membership');
    }
  }

  private assertCanChange(
    actorRole: OrganizationRole,
    targetRole: OrganizationRole,
    nextRole?: OrganizationRole,
  ): void {
    if (
      actorRole !== 'owner' &&
      (targetRole === 'owner' || nextRole === 'owner')
    ) {
      throw new ForbiddenException('Only owners can manage owner membership');
    }
  }

  private async assertOwnerRemains(
    target: MembershipDocument,
    nextRole: OrganizationRole | undefined,
    session: ClientSession,
  ): Promise<void> {
    if (target.role !== 'owner' || nextRole === 'owner') {
      return;
    }
    const owners = await this.collection.countDocuments(
      { organizationId: target.organizationId, role: 'owner' },
      { session },
    );
    if (owners <= 1) {
      throw new ConflictException(
        'Organization must retain at least one owner',
      );
    }
  }

  private toView(document: MembershipDocument): MembershipView {
    return {
      id: document._id.toHexString(),
      subject: document.subject,
      role: document.role,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
