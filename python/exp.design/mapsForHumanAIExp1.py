import numpy as np
import random
import itertools as it
import json
from math import floor

class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NpEncoder, self).default(obj)

def calculateGridDis(grid1, grid2):
    gridDis = np.linalg.norm(np.array(grid1) - np.array(grid2), ord=1)
    return gridDis


# class CreateMapFor1P1G():
#     def __init__(self,direction,gridSize):
#         self.direction=[0, 90, 180, 270]
#         self.gridSize=gridSize

#     def __call__(self, bottom, height):
#         direction=random.choice(self.direction)
#         if direction==0:
#             initPlayerGrid=(floor(self.gridSize/2),random.randint(height,self.gridSize-1))
#             target1Grid=(initPlayerGrid[0]-floor(bottom/2),initPlayerGrid[1]-height)
#             target2Grid=(initPlayerGrid[0]+floor(bottom/2),initPlayerGrid[1]-height)
#         elif direction==180:
#             initPlayerGrid = (floor(self.gridSize / 2),random.randint(0, self.gridSize - 1-height))
#             target1Grid = (initPlayerGrid[0] - floor(bottom / 2), initPlayerGrid[1] + height)
#             target2Grid = (initPlayerGrid[0] + floor(bottom / 2), initPlayerGrid[1] + height)
#         elif direction==90:
#             initPlayerGrid = (random.randint(0, self.gridSize - 1-height),floor(self.gridSize / 2))
#             target1Grid = (initPlayerGrid[0] + height,initPlayerGrid[1]- floor(bottom / 2) )
#             target2Grid = (initPlayerGrid[0] + height,initPlayerGrid[1]+ floor(bottom / 2))
#         else:
#             initPlayerGrid = (random.randint(height,self.gridSize-1),floor(self.gridSize / 2))
#             target1Grid = (initPlayerGrid[0] - height, initPlayerGrid[1] - floor(bottom / 2))
#             target2Grid = (initPlayerGrid[0] - height, initPlayerGrid[1] + floor(bottom / 2))
#         return initPlayerGrid, target1Grid, target2Grid


class CreateMaps():
    def __init__(self, gridSize):
        self.gridSize = gridSize
        self.direction = [0, 90, 180, 270]
        self.bottom = [10,12,14]
        self.height = [5, 6, 7]

    def __call__(self, conditionName):
        direction=  random.choice(self.direction)
        bottom = random.choice(self.bottom)
        height = random.choice(self.height)

        if direction==0:
            initPlayerGrid = (floor(self.gridSize/2), random.randint(2* height, self.gridSize - 1))
            initAIGrid = (initPlayerGrid[0], initPlayerGrid[1] - 2 * height)
            target1Grid = (initPlayerGrid[0] - floor(bottom/2), initPlayerGrid[1]-height)
            target2Grid = (initPlayerGrid[0] + floor(bottom/2), initPlayerGrid[1]-height)
        elif direction==180:
            initPlayerGrid = (floor(self.gridSize / 2), random.randint(0, self.gridSize - 2 * height - 1))
            initAIGrid = (initPlayerGrid[0],initPlayerGrid[1]+ 2 * height)
            target1Grid = (initPlayerGrid[0] - floor(bottom / 2), initPlayerGrid[1] + height)
            target2Grid = (initPlayerGrid[0] + floor(bottom / 2), initPlayerGrid[1] + height)
        elif direction==90:
            initPlayerGrid = (random.randint(0, self.gridSize - 2 * height - 1), floor(self.gridSize / 2))
            initAIGrid = (initPlayerGrid[0] + 2 * height, initPlayerGrid[1] )
            target1Grid = (initPlayerGrid[0] + height, initPlayerGrid[1]- floor(bottom / 2) )
            target2Grid = (initPlayerGrid[0] + height, initPlayerGrid[1]+ floor(bottom / 2))
        else:
            initPlayerGrid = (random.randint(2 * height, self.gridSize - 1), floor(self.gridSize / 2))
            initAIGrid = (initPlayerGrid[0] - 2 * height,initPlayerGrid[1] )
            target1Grid = (initPlayerGrid[0] - height, initPlayerGrid[1] - floor(bottom / 2))
            target2Grid = (initPlayerGrid[0] - height, initPlayerGrid[1] + floor(bottom / 2))

        if conditionName == '1P1G':
            return initPlayerGrid, target1Grid
        elif conditionName == '1P2G':
            return initAIGrid, target1Grid, target2Grid
        elif conditionName == '2P2G':
            return initPlayerGrid, initAIGrid, target1Grid, target2Grid
        elif conditionName == '2P3G':
            return initPlayerGrid, initAIGrid, target1Grid, target2Grid
        else:
            raise ValueError(f"Invalid map type: {conditionName}")


if __name__ == '__main__':
    gridSize = 15
    createMaps = CreateMaps(gridSize)

    df1P1G = {}
    df1P2G = {}
    df2P2G = {}
    df2P3G = {}

    trialTypes = ['1P1G', '1P2G', '2P2G', '2P3G']
    trialNums = [99, 99, 99, 99]
    allConditionNames = [conditionName for conditionName in trialTypes for _ in range(trialNums[trialTypes.index(conditionName)])]

    for mapIndex, conditionName in enumerate(allConditionNames):
        if conditionName == '1P1G':
            initPlayerGrid, target1Grid = createMaps(conditionName)

            mapData1P1G = {
                'initPlayerGrid': initPlayerGrid,
                'target1': target1Grid,
                'mapType': conditionName,
            }
            df1P1G[mapIndex] = [mapData1P1G]

        elif conditionName == '1P2G':
            initPlayerGrid, target1Grid, target2Grid = createMaps(conditionName)
            mapData1P2G = {
                'initPlayerGrid': initPlayerGrid,
                'target1': target1Grid,
                'target2': target2Grid,
                'mapType': conditionName,
            }
            df1P2G[mapIndex] = [mapData1P2G]

        elif conditionName == '2P2G':
            initPlayerGrid, initAIGrid, target1Grid, target2Grid = createMaps(conditionName)
            mapData2P2G = {
                'initPlayerGrid': initPlayerGrid,
                'initAIGrid': initAIGrid,
                'target1': target1Grid,
                'target2': target2Grid,
                'mapType': conditionName,
            }
            df2P2G[mapIndex] = [mapData2P2G]

        elif conditionName == '2P3G':
            initPlayerGrid, initAIGrid, target1Grid, target2Grid = createMaps(conditionName)
            mapData2P3G = {
                'initPlayerGrid': initPlayerGrid,
                'initAIGrid': initAIGrid,
                'target1': target1Grid,
                'target2': target2Grid,
                'mapType': conditionName,
            }
            df2P3G[mapIndex] = [mapData2P3G]


    # Save to files
    import os

    # Get the current directory and construct the path to static/config
    current_dir = os.path.dirname(os.path.abspath(__file__))
    static_config_path = os.path.join(current_dir, '..', 'config')
    print(static_config_path)

    # Update file paths to use the constructed path
    PRACTICE_CONFIG_FILE = os.path.join(static_config_path, "MapsFor1P1G.js")
    EXP_CONFIG_FILE1 = os.path.join(static_config_path, "MapsFor1P2G.js")
    EXP_CONFIG_FILE2 = os.path.join(static_config_path, "MapsFor2P2G.js")
    EXP_CONFIG_FILE3 = os.path.join(static_config_path, "MapsFor2P3G.js")


    # Save  maps
    with open(PRACTICE_CONFIG_FILE, "w") as f:
        f.write("const MapsFor1P1G = ")
        json.dump(df1P1G, f, indent=4, cls=NpEncoder)
        f.write(";")

    with open(EXP_CONFIG_FILE1, "w") as f:
        f.write("const MapsFor1P2G = ")
        json.dump(df1P2G, f, indent=4, cls=NpEncoder)
        f.write(";")

    with open(EXP_CONFIG_FILE2, "w") as f:
        f.write("const MapsFor2P2G = ")
        json.dump(df2P2G, f, indent=4, cls=NpEncoder)
        f.write(";")

    with open(EXP_CONFIG_FILE3, "w") as f:
        f.write("const MapsFor2P3G = ")
        json.dump(df2P3G, f, indent=4, cls=NpEncoder)
        f.write(";")
