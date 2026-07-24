## 2024-07-24 - Group Downtime Events by Camera ID
**Learning:** Found a critical performance bottleneck in `main.py`'s `get_reports_charts` where the nested loop inside `calculate_downtime_in_memory` iterated over all downtime events in an O(N^2) fashion.
**Action:** When filtering a large list of database models (like DowntimeEvents) for multiple parent records (like Cameras) in memory, avoid O(N) array scans inside loops. Group the records by their parent ID into a dictionary (`events_by_camera = {}`) first. This turns the inner loop lookup into O(1), giving massive speedups.
