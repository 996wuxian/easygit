import { IconFileCode } from '@tabler/icons-react';
import { SelectMenu } from '../SelectMenu';

export function ComparisonFileSelect({ files, selected, onSelect }: {
  files: readonly { path: string }[];
  selected: string;
  onSelect?: (path: string) => void;
}) {
  const paths = files.some(file => file.path === selected)
    ? files.map(file => file.path)
    : [selected, ...files.map(file => file.path)];
  return <SelectMenu className="comparison-file-select" label="切换比对文件" listLabel="比对文件"
    value={selected} onChange={onSelect} options={paths.map(path => ({ value: path, label: path, icon: <IconFileCode size={16} aria-hidden="true" /> }))} />;
}
