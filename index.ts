import { promises as fs } from 'fs';
import fetch, { Response } from 'node-fetch';

interface Color {
  code: string;
  weight: number;
}

interface Photo {
  name: string;
  album: string;
  public_id: string;
  format: string;
  version: number;
  created_at: Date;
  width: number;
  height: number;
  colors?: Color[];
  tags: string[];
}

interface Folder {
  name: string;
  path: string;
}

const contentRoot: string = './albums';
const api: string = 'api.cloudinary.com/v1_1';
const key: string = process.env['KEY'] || '';
const secret: string = process.env['SECRET'] || '';
const cloudName: string = 'matt-finucane-portfolio';
const baseUrl: string = `https://${key}:${secret}@${api}/${cloudName}`;

const resetContent = async (): Promise<void> => {
  await fs.rmdir(contentRoot, { recursive: true });
  await fs.mkdir(contentRoot);
};

const createFolders = async (folders: Folder[]): Promise<void[]> => Promise.all([
  ...folders.map(({ path }: Folder) => (
    fs.mkdir(`${contentRoot}/${path}`)
  )),
  fs.mkdir(`${contentRoot}/featured`)
]);

const getAlbumName = (public_id: string): string => public_id.split('/')[0];
const getPhotoName = (public_id: string): string => public_id.split('/')[1];
const remapColors = (colors: any): Color[] => colors.map((color: any): Color => ({
  code: color[0],
  weight: color[1]
}));

const processPhoto = ({
  public_id,
  format,
  version,
  created_at,
  width,
  height,
  colors,
  tags,
}: any): Photo => ({
  name: getPhotoName(public_id),
  album: getAlbumName(public_id),
  public_id,
  format,
  version,
  created_at,
  width,
  height,
  ...(tags ? { tags } : { tags: [] }),
  ...(colors && { colors: remapColors(colors) })
});

const requestAllPhotos = async (max: number = 10): Promise<Photo[]> => {
  const url: string = `${baseUrl}/resources/image?max_results=${max}&tags=true`;
  const response: Response = await fetch(url);
  const { resources } = await response.json();

  return resources.map((resource: any) => processPhoto(resource));
};

const requestFolders = async (): Promise<Folder[]> => {
  const url: string = `${baseUrl}/folders`;
  const response: Response = await fetch(url);
  const { folders } = await response.json();

  return folders;
};

const requestPhoto = async (public_id: string): Promise<Photo> => {
  console.log(`Requesting photo: ${public_id}, ${encodeURI(public_id)}`);
  const url: string = `${baseUrl}/resources/image/upload/${encodeURI(public_id)}?image_metadata=true&colors=true`
  const response: Response = await fetch(url);
  const photo = await response.json();

  return processPhoto(photo);
};

export const writeIndexJSON = async (folder: Folder, photos: Photo[]): Promise<void> => {
  const { name, path } = folder;
  const content: string = JSON.stringify({
    name, photos
  });

  return await fs.writeFile(`${contentRoot}/${path}/index.json`, content);
};

export const writeAlbumIndices = (folders: Folder[], photos: Photo[]): Promise<void[]> => Promise.all([
  ...folders.map((folder: Folder): Promise<void> => writeIndexJSON(
    folder,
    photos.filter(({ album }: Photo): boolean => album === folder.name)
  )),
  writeIndexJSON(
    { name: 'featured', path: 'featured' } as Folder,
    photos.filter(({ tags }: Photo): boolean => tags.includes('featured'))
  )
]);

export const writePhotoJSON = async(photo: Photo): Promise<void> => {
  const { album, name, tags } = photo;
  const content = JSON.stringify(photo);

  if (tags.includes('featured')) {
    await fs.writeFile(`${contentRoot}/featured/${name}.json`, content);
  }

  return await fs.writeFile(`${contentRoot}/${album}/${name}.json`, content);
};

const run = async (): Promise<void> => {
  let folders: Folder[] = [];
  let photos: Photo[] = [];

  console.log('Starting...');

  try {
    folders = await requestFolders();
    photos = await requestAllPhotos(400);
  } catch (e) {
    console.log('Failed to fetch photos and folders. Exiting', e);
    return;
  }

  // create folders and write album indices
  try {
    await resetContent();
    await createFolders(folders);
    await writeAlbumIndices(folders, photos);
  } catch (e) {
    console.log('Failed to create folders with indices. Exiting', e);
    return;
  }

  /**
   * Sequentually go through each photo and:
   * - make a request to fetch photo details
   * - write photo as JSON file, catching failed writes
   */
  for(let photo of photos) {
    const photoDetail: Photo = await requestPhoto(photo.public_id);

    try {
      await writePhotoJSON(photoDetail);
    } catch {
      console.log(`Failed to write: ${photo.public_id} - skipping`);
    }

    console.log(`Fetched and wrote: ${photo.public_id}`);
  }

  // finished
  console.log('Done!');
};

run();
