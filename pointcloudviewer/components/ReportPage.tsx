import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CurrentMeasurement, Measurement } from "@/src/types/measurement";
import { toSafeFileUrl } from "@/lib/safeFile";
import { MoreVertical, Download, Pencil, Trash2 } from "lucide-react";

interface ReportPageProps {
  measurements: Measurement[];
  currentMeasurement: CurrentMeasurement | null;
  canSave: boolean;
  onSaveMeasurement: (name: string) => void;
  hasScene: boolean;
  onSelectMeasurement: (measurement: Measurement) => void;
  onDeleteMeasurement: (measurement: Measurement) => void;
  onRenameMeasurement: (measurement: Measurement, name: string) => void;
}

export function ReportPage({
  measurements,
  currentMeasurement,
  canSave,
  onSaveMeasurement,
  hasScene,
  onSelectMeasurement,
  onDeleteMeasurement,
  onRenameMeasurement,
}: ReportPageProps) {
  const [name, setName] = useState("");
  const [menuState, setMenuState] = useState<{
    x: number;
    y: number;
    measurement: Measurement;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameActive, setRenameActive] = useState(false);
  const [sortState, setSortState] = useState<{ key: 'name' | 'value' | 'unit' | 'createdAt'; direction: 'asc' | 'desc' } | null>(null);
  const trimmedName = useMemo(() => name.trim(), [name]);
  const canSubmit = canSave && trimmedName.length > 0;

  const handleSave = () => {
    if (!canSubmit) return;
    onSaveMeasurement(trimmedName);
    setName("");
  };

  const resetMenu = () => {
    setMenuState(null);
    setRenameActive(false);
    setRenameValue("");
  };

  const sortedMeasurements = useMemo(() => {
    if (!sortState) return measurements;
    const { key, direction } = sortState;
    const dir = direction === 'asc' ? 1 : -1;
    return [...measurements].sort((a, b) => {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (key === 'value') {
        return (Number(av) - Number(bv)) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [measurements, sortState]);

  const toggleSort = (key: 'name' | 'value' | 'unit' | 'createdAt') => {
    setSortState((prev) => {
      if (!prev || prev.key !== key) {
        return { key, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' };
      }
      return null;
    });
  };

  const sortIndicator = (key: 'name' | 'value' | 'unit' | 'createdAt') => {
    if (!sortState || sortState.key !== key) return null;
    return (
      <span className="text-[10px] text-muted-foreground ml-1">
        {sortState.direction === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  return (
    <div
      className="flex flex-col h-full bg-background outline-none focus:ring-2 focus:ring-muted-foreground/30 focus:ring-inset"
      tabIndex={0}
      onClick={resetMenu}
    >
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Report Page</h2>
          <Button variant="ghost" size="icon" aria-label="Export report">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!hasScene && (
          <p className="text-xs text-muted-foreground">
            Open a scene to save measurements.
          </p>
        )}

        {hasScene && (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Current measurement:{" "}
                {currentMeasurement
                  ? `${currentMeasurement.value.toFixed(3)} ${currentMeasurement.unit} (${currentMeasurement.kind})`
                  : "not ready"}
              </div>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Measurement name"
                />
                <Button onClick={handleSave} disabled={!canSubmit}>
                  Save
                </Button>
              </div>
              {!canSave && (
                <div className="text-xs text-muted-foreground">
                  Add points in distance or area mode to enable saving.
                </div>
              )}
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-2 py-2 w-10"></th>
                    <th className="text-left font-medium px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                      <span className="inline-flex items-center">Name{sortIndicator('name')}</span>
                    </th>
                    <th className="text-left font-medium px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('value')}>
                      <span className="inline-flex items-center">Value{sortIndicator('value')}</span>
                    </th>
                    <th className="text-left font-medium px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('unit')}>
                      <span className="inline-flex items-center">Unit{sortIndicator('unit')}</span>
                    </th>
                    <th className="text-left font-medium px-3 py-2">Snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.length === 0 && (
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground" colSpan={5}>
                        No saved measurements yet.
                      </td>
                    </tr>
                  )}
                  {sortedMeasurements.map((measurement) => (
                    <tr
                      key={measurement.id}
                      className="border-t border-border cursor-pointer hover:bg-muted/30"
                      onClick={() => onSelectMeasurement(measurement)}
                      title={measurement.imagePath ? "Jump to image" : "No image linked"}
                    >
                      <td className="px-2 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenuState({
                              x: rect.left,
                              y: rect.bottom,
                              measurement,
                            });
                            setRenameActive(false);
                            setRenameValue("");
                          }}
                          aria-label="Open measurement actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </td>
                      <td className="px-3 py-2">{measurement.name}</td>
                      <td className="px-3 py-2">
                        {measurement.value.toFixed(3)}
                      </td>
                      <td className="px-3 py-2">{measurement.unit}</td>
                      <td className="px-3 py-2">
                        {measurement.snapshotPath ? (
                          <img
                            src={toSafeFileUrl(measurement.snapshotPath)}
                            alt={`${measurement.name} snapshot`}
                            className="h-10 w-16 object-cover rounded-sm border border-border"
                          />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {menuState && (
        <div
          className="fixed z-50 rounded-md border border-border bg-background shadow-md"
          style={{ left: menuState.x, top: menuState.y }}
          onMouseLeave={resetMenu}
          onClick={(event) => event.stopPropagation()}
        >
          {!renameActive && (
            <>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              setRenameActive(true);
              setRenameValue(menuState.measurement.name);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Rename</span>
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => {
              onDeleteMeasurement(menuState.measurement);
              resetMenu();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
            </>
          )}
          {renameActive && (
            <div className="p-2 space-y-2">
              <Input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const nextName = renameValue.trim();
                    if (nextName) {
                      onRenameMeasurement(menuState.measurement, nextName);
                    }
                    resetMenu();
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetMenu}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
