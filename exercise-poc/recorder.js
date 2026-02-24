/**
 * MayaMind Exercise POC — Data Recorder
 *
 * Records timestamped joint angle data for later analysis.
 * Exports to CSV format.
 */

/**
 * Data recorder class
 */
export class DataRecorder {
  constructor(options = {}) {
    this.isRecording = false;
    this.startTime = null;
    this.data = [];
    this.jointKeys = [
      'leftKnee', 'rightKnee',
      'leftHip', 'rightHip',
      'leftElbow', 'rightElbow',
      'leftShoulder', 'rightShoulder',
    ];

    // Max file size limit (default 100 MB)
    this.maxSizeBytes = options.maxSizeBytes || 100 * 1024 * 1024;
    this.estimatedRowSize = 300; // Approximate bytes per CSV row
    this.maxRows = Math.floor(this.maxSizeBytes / this.estimatedRowSize);

    // Callback when max size reached
    this.onMaxSizeReached = options.onMaxSizeReached || null;
  }

  /**
   * Start recording
   */
  start() {
    this.isRecording = true;
    this.startTime = Date.now();
    this.data = [];
  }

  /**
   * Stop recording
   */
  stop() {
    this.isRecording = false;
  }

  /**
   * Record a frame of angle data
   *
   * @param {Object} angles - Joint angles from calculateJointAngles()
   * @param {Object} squatStatus - Optional squat detector status
   * @returns {boolean} true if recorded, false if skipped (max size reached)
   */
  record(angles, squatStatus = null) {
    if (!this.isRecording || !angles) return false;

    // Check if we've reached max size
    if (this.data.length >= this.maxRows) {
      this.stop();
      if (this.onMaxSizeReached) {
        this.onMaxSizeReached(this.getEstimatedSize());
      }
      return false;
    }

    const timestamp = Date.now();
    const elapsed = timestamp - this.startTime;

    // Format timestamp as ISO string for readability
    const isoTime = new Date(timestamp).toISOString();

    const row = {
      timestamp,
      isoTime,
      elapsed,
      frame: this.data.length + 1,
    };

    // Add all joint angles
    for (const key of this.jointKeys) {
      const joint = angles[key];
      row[`${key}_angle`] = joint?.angle ?? null;
      row[`${key}_visible`] = joint?.visible ?? false;
    }

    // Add squat status if available
    if (squatStatus) {
      row.squat_state = squatStatus.state;
      row.squat_repCount = squatStatus.repCount;
      row.squat_orientation = squatStatus.orientation;
      row.squat_currentMinHip = squatStatus.currentRepMinHip;
      row.squat_currentMinKnee = squatStatus.currentRepMinKnee;
      row.squat_hipDrop = squatStatus.currentHipDrop;
    }

    this.data.push(row);
    return true;
  }

  /**
   * Get estimated size of recorded data in bytes
   */
  getEstimatedSize() {
    return this.data.length * this.estimatedRowSize;
  }

  /**
   * Get estimated size formatted as string
   */
  getEstimatedSizeFormatted() {
    const bytes = this.getEstimatedSize();
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get recorded data
   */
  getData() {
    return this.data;
  }

  /**
   * Get recording duration in seconds
   */
  getDuration() {
    if (!this.startTime) return 0;
    const endTime = this.isRecording ? Date.now() : this.data[this.data.length - 1]?.timestamp ?? this.startTime;
    return (endTime - this.startTime) / 1000;
  }

  /**
   * Get frame count
   */
  getFrameCount() {
    return this.data.length;
  }

  /**
   * Convert recorded data to CSV string
   */
  toCSV() {
    if (this.data.length === 0) return '';

    // Get all column headers from first row
    const headers = Object.keys(this.data[0]);

    // Build CSV
    const lines = [];

    // Header row
    lines.push(headers.join(','));

    // Data rows
    for (const row of this.data) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'boolean') return val ? '1' : '0';
        if (typeof val === 'number') return val.toFixed(2);
        return `"${val}"`;
      });
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  /**
   * Download data as CSV file
   */
  downloadCSV(filename = null) {
    const csv = this.toCSV();
    if (!csv) {
      console.warn('No data to download');
      return;
    }

    // Generate filename with timestamp
    if (!filename) {
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10);
      const timeStr = date.toTimeString().slice(0, 8).replace(/:/g, '-');
      filename = `exercise-data-${dateStr}-${timeStr}.csv`;
    }

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Clear recorded data
   */
  clear() {
    this.data = [];
    this.startTime = null;
    this.isRecording = false;
  }
}
