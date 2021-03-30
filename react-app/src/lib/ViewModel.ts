import UserProfileClient, {
  UserProfile,
} from "lib/comm/coreServices/UserProfileClient";

import {
  FieldValue,
  Format,
  SchemaField,
  UserFieldValue,
} from "lib/client/samples/Samples";
import { SampleId, SampleVersion } from "lib/client/Sample";

import Model from "./Model";

import { EpochTimeMS, SimpleMap, Username } from "./types";
import SampleServiceClient, { DataLink } from "./client/SampleServiceClient";

// Constants

import { UPSTREAM_TIMEOUT } from "../appConstants";
import { DynamicServiceConfig } from "@kbase/ui-components/lib/redux/integration/store";
import { Workspace } from "@kbase/ui-lib";
import { ObjectInfo } from "@kbase/ui-lib/lib/lib/comm/coreServices/Workspace";
import { LinkedData } from "redux/store/linkedData";

// Types

export type FieldDefinitionsMap = { [key: string]: SchemaField };

export interface Sample {
  // id generated by sample service
  id: SampleId;

  // supplied in the sample as the ____
  name: string;

  // supplied in the sample as some field mapped to the sample id; must be
  // unique
  sampleId: string;

  // Supplied in the sample as some field mapped to another sample
  parentSampleId: string | null;

  // Chosen in the sample importer; is it used for anything?
  type: string;

  created: {
    at: EpochTimeMS;
    by: User;
  };

  currentVersion: {
    at: EpochTimeMS;
    by: User;
    version: number;
  };
  latestVersion: {
    at: EpochTimeMS;
    by: User;
    version: number;
  };

  metadata: Array<MetadataField>;
  controlled: SimpleMap<MetadataControlledField>;
  formatId: string;
  template: Template;
  format: Format;
}

export interface User {
  username: Username;
  realname: string;
  gravatarHash: string;
  avatarOption?: string;
  gravatarDefault?: string;
}

// Template

export interface TemplateFieldBase {
  type: string;
}

export interface TemplateFormatField extends TemplateFieldBase {
  type: "metadata";
  key: string;
}

export interface TemplateUserField extends TemplateFieldBase {
  type: "user";
  key: string; // really isn't a key for a user field, but that is all that the
  // sample service gives us for them, so we have to keep it in our
  // fake, and maybe eventually in the real template, so we can use
  // it to pluck the user metadata field out of the samples' meta_user
  label: string;
}

export type TemplateField = TemplateFormatField | TemplateUserField;

// For now, a template is simply an ordered set of sample field keys.
export type Template = {
  header?: Array<string>;
  fields: Array<TemplateField>;
};

// Metadata

export interface UserMetadata {
  [label: string]: string;
}

export interface MetadataFieldBase {
  type: string;
  key: string;
  label: string;
  isEmpty: boolean;
}

export interface MetadataControlledField extends MetadataFieldBase {
  type: "controlled";
  field: FieldValue;
}

export interface MetadataUserField extends MetadataFieldBase {
  type: "user";
  field: UserFieldValue;
}

export type MetadataField =
  | MetadataControlledField
  | MetadataUserField;

export interface MetadataSource {
  [key: string]: MetadataSourceField;
}

export interface MetadataSourceField {
  key: string;
  label: string;
  value: string;
}

export type FormatName = string;

export interface FetchSampleProps {
  serviceWizardURL: string;
  userProfileURL: string;
  token: string;
  sampleId: SampleId;
  sampleVersion?: SampleVersion;
  setTitle: (title: string) => void;
}

export interface UserProfileMap {
  [username: string]: UserProfile;
}

export interface ACL {
  admin: Array<User>;
  write: Array<User>;
  read: Array<User>;
}

export interface DataLink2 extends DataLink {
  key: string;
  objectType: string;
  objectName: string;
}

export default class ViewModel {
  userProfileURL: string;
  serviceWizardURL: string;
  workspaceURL: string;
  sampleServiceConfig: DynamicServiceConfig;
  token: string;
  timeout: number;

  constructor(
    {
      userProfileURL,
      serviceWizardURL,
      workspaceURL,
      sampleServiceConfig,
      token,
      timeout,
    }: {
      userProfileURL: string;
      serviceWizardURL: string;
      workspaceURL: string;
      token: string;
      timeout: number;
      sampleServiceConfig: DynamicServiceConfig;
    },
  ) {
    this.userProfileURL = userProfileURL;
    this.serviceWizardURL = serviceWizardURL;
    this.workspaceURL = workspaceURL;
    this.token = token;
    this.timeout = timeout;
    this.sampleServiceConfig = sampleServiceConfig;
  }

  async fetchUsers(
    { usernames }: { usernames: Array<Username> },
  ): Promise<Array<User>> {
    const userProfileClient = new UserProfileClient({
      token: this.token,
      url: this.userProfileURL,
      timeout: UPSTREAM_TIMEOUT,
    });

    const profiles = await userProfileClient.get_user_profile(usernames);

    if (profiles.length !== 1) {
      throw new Error("User could not be found");
    }

    return profiles.map((profile) => {
      const {
        user: {
          username,
          realname,
        },
        profile: {
          synced: {
            gravatarHash,
          },
          userdata: {
            gravatarDefault,
            avatarOption,
          },
        },
      } = profile;
      return {
        username,
        realname,
        gravatarHash,
        gravatarDefault,
        avatarOption,
      };
    });
  }

  async fetchSample(
    { id: sampleId, version: sampleVersion }: { id: string; version?: number },
  ): Promise<Sample> {
    const client = new Model({
      token: this.token,
      url: this.serviceWizardURL,
      timeout: UPSTREAM_TIMEOUT,
    });

    const sampleResult = await client.getSample({
      id: sampleId,
      version: sampleVersion,
    });

    const latestSample = await client.getSample({
      id: sampleId,
    });

    const firstSample = await (async () => {
      if (sampleResult.version === 1) {
        return sampleResult;
      }
      return await client.getSample({
        id: sampleId,
        version: 1,
      });
    })();

    const users = await this.fetchUsers({
      usernames: Array.from(new Set([
        firstSample.savedBy,
        sampleResult.savedBy,
        latestSample.savedBy,
      ]).values()),
    });

    const usersMap = users.reduce((usersMap, user) => {
      usersMap.set(user.username, user);
      return usersMap;
    }, new Map<Username, User>());

    // const fieldKeys: Array<string> = Object.keys(sampleResult.sample.controlled);
    const { format } = await client.getFormat({ id: sampleResult.formatId });
    // const {fields} = await client.getFieldDefinitions({keys: fieldKeys});

    const sample: Sample = {
      id: sampleResult.id,
      sampleId: sampleResult.sample.id,
      parentSampleId: sampleResult.sample.parentId,
      type: sampleResult.sample.type,
      name: sampleResult.name,
      created: {
        at: firstSample.savedAt,
        by: usersMap.get(firstSample.savedBy)!,
      },
      currentVersion: {
        at: sampleResult.savedAt,
        by: usersMap.get(sampleResult.savedBy)!,
        version: sampleResult.version,
      },
      latestVersion: {
        at: latestSample.savedAt,
        by: usersMap.get(latestSample.savedBy)!,
        version: latestSample.version,
      },
      metadata: sampleResult.sample.metadata,
      controlled: sampleResult.sample.controlled,
      formatId: sampleResult.formatId,
      format,
      template: sampleResult.template,
    };
    return sample;
  }

  async fetchACL({ id }: { id: string }) {
    const client = new SampleServiceClient({
      token: this.token,
      url: this.serviceWizardURL,
      timeout: UPSTREAM_TIMEOUT,
      version: this.sampleServiceConfig.version,
    });

    const aclResult = await client.get_sample_acls({
      id,
      as_admin: 0,
    });

    const usersToFetch: Array<Username> = aclResult.admin.concat(
      aclResult.read,
    ).concat(aclResult.write);

    const userProfileClient = new UserProfileClient({
      token: this.token,
      url: this.userProfileURL,
      timeout: UPSTREAM_TIMEOUT,
    });

    const profiles = await userProfileClient.get_user_profile(usersToFetch);
    const profileMap: UserProfileMap = profiles.reduce<UserProfileMap>(
      (profileMap, profile) => {
        profileMap[profile.user.username] = profile;
        return profileMap;
      },
      {},
    );

    const acl: ACL = {
      admin: aclResult.admin.map((username) => {
        const profile = profileMap[username];
        return {
          username,
          realname: profile.user.realname,
          gravatarHash: profile.profile.synced.gravatarHash,
          gravatarDefault: profile.profile.userdata.gravatarDefault,
          avatarOption: profile.profile.userdata.avatarOption,
        };
      }),
      write: aclResult.write.map((username) => {
        const profile = profileMap[username];
        return {
          username,
          realname: profile.user.realname,
          gravatarHash: profile.profile.synced.gravatarHash,
          gravatarDefault: profile.profile.userdata.gravatarDefault,
          avatarOption: profile.profile.userdata.avatarOption,
        };
      }),
      read: aclResult.read.map((username) => {
        const profile = profileMap[username];
        return {
          username,
          realname: profile.user.realname,
          gravatarHash: profile.profile.synced.gravatarHash,
          gravatarDefault: profile.profile.userdata.gravatarDefault,
          avatarOption: profile.profile.userdata.avatarOption,
        };
      }),
    };

    return acl;
  }

  async fetchLinkedData({ id, version }: {
    id: string;
    version: number;
  }): Promise<LinkedData> {
    const client = new SampleServiceClient({
      token: this.token,
      url: this.serviceWizardURL,
      timeout: UPSTREAM_TIMEOUT,
      version: this.sampleServiceConfig.version,
    });

    const dataLinks = await client.get_data_links_from_sample({
      id: id,
      version: version,
    });

    const objectRefs = dataLinks.links.map((dataLink) => {
      return dataLink.upa;
    });

    if (objectRefs.length === 0) {
      return [];
    }

    const workspaceClient = new Workspace({
      token: this.token,
      url: this.workspaceURL,
      timeout: UPSTREAM_TIMEOUT,
    });

    const objectInfos = await workspaceClient.get_object_info3({
      includeMetadata: 1,
      objects: objectRefs.map((ref) => {
        return { ref };
      }),
    });

    const objectMap = objectInfos.infos.reduce((objectMap, info) => {
      const [objectId, , , , version, , workspaceId] = info;
      const ref = [workspaceId, objectId, version].join("/");
      objectMap.set(ref, info);
      return objectMap;
    }, new Map<string, ObjectInfo>());

    const dataLinksWithKey: Array<DataLink2> = dataLinks.links.map(
      (dataLink) => {
        const objectInfo = objectMap.get(dataLink.upa);
        if (!objectInfo) {
          throw new Error("Object not found: " + dataLink.upa);
        }
        return {
          ...dataLink,
          key: dataLink.upa,
          objectName: objectInfo[1],
          objectType: objectInfo[2],
        };
      },
    );

    return dataLinksWithKey;
  }
}
