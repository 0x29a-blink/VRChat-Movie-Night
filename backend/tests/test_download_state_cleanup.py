import asyncio

from app.downloads.manager import DownloadManager
from app.models import Job


def test_finish_clears_task_and_cancelled_state(db):
    mgr = DownloadManager()
    job = Job(id="j1", type="youtube", source="src", title="t", status="downloading")
    db.add(job)
    db.commit()

    async def scenario():
        async def dummy():
            await asyncio.sleep(60)

        task = asyncio.ensure_future(dummy())
        mgr._tasks["j1"] = task
        mgr._cancelled.add("j1")
        await mgr._finish("j1", "cancelled")
        task.cancel()

    asyncio.run(scenario())
    assert "j1" not in mgr._tasks
    assert "j1" not in mgr._cancelled
