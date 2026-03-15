using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Numerics;
using SharpFAI.Serialization;
using SharpFAI.Util;

namespace SharpFAI.Framework;

/// <summary>
/// Represents a floor tile in ADOFAI with polygon mesh data
/// 表示ADOFAI中的地板瓦片及其多边形网格数据
/// </summary>
public class Floor
{
    /// <summary>
    /// Default length of the floor tile / 地板瓦片的默认长度
    /// </summary>
    public static float length = 75;
    
    /// <summary>
    /// Default width of the floor tile / 地板瓦片的默认宽度
    /// </summary>
    public static float width = 41.75f;
    
    /// <summary>
    /// Outline thickness for the floor border / 地板边框的轮廓厚度
    /// </summary>
    public const float outline = 2f;
    
    /// <summary>
    /// Entry angle of the floor in degrees / 地板的入口角度（度）
    /// </summary>
    public readonly double entryAngle;
    
    /// <summary>
    /// Exit angle of the floor in degrees / 地板的出口角度（度）
    /// </summary>
    public readonly double exitAngle;
    
    /// <summary>
    /// Current angle of the floor / 地板的当前角度
    /// </summary>
    public float angle = 0;
    
    /// <summary>
    /// Whether this is a midspin floor / 是否为中旋地板
    /// </summary>
    public bool isMidspin;
    
    /// <summary>
    /// Whether the rotation is clockwise / 旋转是否为顺时针
    /// </summary>
    public bool isCW = false;

    /// <summary>
    /// Reference to the previous floor / 对前一个地板的引用
    /// </summary>
    public Floor lastFloor;
    
    /// <summary>
    /// Reference to the next floor / 对下一个地板的引用
    /// </summary>
    public Floor nextFloor;

    /// <summary>
    /// BPM (beats per minute) at this floor / 此地板处的BPM（每分钟节拍数）
    /// </summary>
    public double bpm = 0;
    
    /// <summary>
    /// Entry time of this floor in milliseconds / 此地板的入口时间（毫秒）
    /// </summary>
    public double entryTime = 0;

    /// <summary>
    /// World position of the floor / 地板的世界坐标位置
    /// </summary>
    public Vector2 position;
    
    /// <summary>
    /// Cached polygon mesh data / 缓存的多边形网格数据
    /// </summary>
    private Polygon floorPolygon;

    /// <summary>
    /// List of events on this floor / 此地板上的事件列表
    /// </summary>
    public List<BaseEvent> events = [];
    
    /// <summary>
    /// Index of this floor in the level / 此地板在关卡中的索引
    /// </summary>
    public int index = 0;

    /// <summary>
    /// Rendering order / 渲染顺序
    /// </summary>
    public int renderOrder = 0;
    
    /// <summary>
    /// Creates a new floor tile with specified angles and position
    /// 创建具有指定角度和位置的新地板瓦片
    /// </summary>
    /// <param name="entryAngle">Entry angle in degrees / 入口角度（度）</param>
    /// <param name="exitAngle">Exit angle in degrees / 出口角度（度）</param>
    /// <param name="position">World position of the floor / 地板的世界坐标位置</param>
    public Floor(double entryAngle, double exitAngle,Vector2 position)
    {
        this.entryAngle = entryAngle;
        this.exitAngle = exitAngle;
        this.position = position;
        isMidspin = false;
    }

    /// <summary>
    /// Generates or returns cached polygon mesh for this floor
    /// 生成或返回此地板的缓存多边形网格
    /// </summary>
    /// <returns>Polygon mesh data containing vertices, triangles and colors / 包含顶点、三角形和颜色的多边形网格数据</returns>
    public Polygon GeneratePolygon()
    {
        if (!floorPolygon.IsEmpty()) return floorPolygon;
        floorPolygon = isMidspin ? CreateMidspinPolygon(entryAngle.ToFloat()) : CreateFloorPolygon();
        return floorPolygon;
    }
    
    private Polygon CreateFloorPolygon() 
    {
        float length = Floor.length;
        float width = Floor.width;
        List<Vector3> vertices = [];
        List<int> triangles = [];
        List<Color> colors = [];

        #region 基础处理
        float m11 = FloatMath.Cos(entryAngle / 180f * FloatMath.PI);
        float m12 = FloatMath.Sin(entryAngle / 180f * FloatMath.PI);
        float m21 = FloatMath.Cos(exitAngle / 180f * FloatMath.PI);
        float m22 = FloatMath.Sin(exitAngle / 180f * FloatMath.PI);
        float[] a = new float[2];

        if ((entryAngle - exitAngle).Fmod(360f) >= (exitAngle - entryAngle).Fmod(360f)) {
            a[0] = entryAngle.Fmod(360f) * FloatMath.PI / 180f;
            a[1] = a[0] + (exitAngle - entryAngle).Fmod(360f) * FloatMath.PI / 180f;
        } else {
            a[0] = exitAngle.Fmod(360f)* FloatMath.PI / 180f;
            a[1] = a[0] + (entryAngle - exitAngle).Fmod(360f) * FloatMath.PI / 180f;
        }
        float angle = a[1] - a[0];
        float mid = a[0] + angle / 2f;
        #endregion
        if (angle is < 2.0943952f and > 0) 
        {
            #region 角度小于2.0943952
            float x;
            if (angle < 0.08726646f) {
                x = 1f;
            } else if (angle < 0.5235988f) {
                x = FloatMath.Lerp(1f, 0.83f, FloatMath.Pow((angle - 0.08726646f) / 0.43633235f, 0.5f));
            } else if (angle < 0.7853982f) {
                x = FloatMath.Lerp(0.83f, 0.77f, FloatMath.Pow((angle - 0.5235988f) / 0.2617994f, 1f));
            } else if (angle < 1.5707964f) {
                x = FloatMath.Lerp(0.77f, 0.15f, FloatMath.Pow((angle - 0.7853982f) / 0.7853982f, 0.7f));
            } else {
                x = FloatMath.Lerp(0.15f, 0f, FloatMath.Pow((angle - 1.5707964f) / 0.5235988f, 0.5f));
            }
            float distance;
            float radius;
            if (x == 1f) {
                distance = 0f;
                radius = width;
            } else {
                radius = FloatMath.Lerp(0f, width, x);
                distance = (width - radius) / FloatMath.Sin(angle / 2f);

            }
            float circlex = -distance * FloatMath.Cos(mid);
            float circley = -distance * FloatMath.Sin(mid);
            width += outline;
            length += outline;
            radius += outline;
            GraphicUtils.CreateCircle(new Vector3(circlex, circley, 0), radius, Color.Black, vertices, triangles, colors, 0);
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(-radius * FloatMath.Sin(a[1]) + circlex, radius * FloatMath.Cos(a[1]) + circley, 0));
                vertices.Add(new Vector3(circlex, circley, 0));
                vertices.Add(new Vector3(radius * FloatMath.Sin(a[0]) + circlex, -radius * FloatMath.Cos(a[0]) + circley, 0));
                vertices.Add(new Vector3(width * FloatMath.Sin(a[0]), -width * FloatMath.Cos(a[0]), 0));
                vertices.Add(Vector3.Zero);
                vertices.Add(new Vector3(-width * FloatMath.Sin(a[1]), width * FloatMath.Cos(a[1]), 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 5);
                triangles.Add(count + 4);
                triangles.Add(count + 1);
                triangles.Add(count + 5);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count + 4);
                triangles.Add(count + 1);
                triangles.Add(count + 3);
                triangles.Add(count + 4);
                for (int i = 0; i < 6; i++) colors.Add(Color.Black);
            }
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0));
                vertices.Add(new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0));
                vertices.Add(new Vector3(-width * m12, width * m11, 0));
                vertices.Add(new Vector3(width * m12, -width * m11, 0));

                vertices.Add(new Vector3(length * m21 + width * m22, length * m22 - width * m21, 0));
                vertices.Add(new Vector3(length * m21 - width * m22, length * m22 + width * m21, 0));
                vertices.Add(new Vector3(-width * m22, width * m21, 0));
                vertices.Add(new Vector3(width * m22, -width * m21, 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                triangles.Add(count + 4);
                triangles.Add(count + 5);
                triangles.Add(count + 6);
                triangles.Add(count + 6);
                triangles.Add(count + 7);
                triangles.Add(count + 4);
                for (int i = 0; i < 8; i++) colors.Add(Color.Black);
            }
            #endregion
            #region 边框
            width -= outline * 2f;
            length -= outline * 2f;
            radius -= outline * 2f;
            if (radius < 0) {
                radius = 0;
                circlex = -width / FloatMath.Sin(angle / 2f) * FloatMath.Cos(mid);
                circley = -width / FloatMath.Sin(angle / 2f) * FloatMath.Sin(mid);
            }
            GraphicUtils.CreateCircle(new Vector3(circlex, circley, 0), radius, Color.White, vertices, triangles, colors, 0);
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(-radius * FloatMath.Sin(a[1]) + circlex, radius * FloatMath.Cos(a[1]) + circley, 0));
                vertices.Add(new Vector3(circlex, circley, 0));
                vertices.Add(new Vector3(radius * FloatMath.Sin(a[0]) + circlex, -radius * FloatMath.Cos(a[0]) + circley, 0));
                vertices.Add(new Vector3(width * FloatMath.Sin(a[0]), -width * FloatMath.Cos(a[0]), 0));
                vertices.Add(Vector3.Zero);
                vertices.Add(new Vector3(-width * FloatMath.Sin(a[1]), width * FloatMath.Cos(a[1]), 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 5);
                triangles.Add(count + 4);
                triangles.Add(count + 1);
                triangles.Add(count + 5);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count + 4);
                triangles.Add(count + 1);
                triangles.Add(count + 3);
                triangles.Add(count + 4);
                for (int i = 0; i < 6; i++) colors.Add(Color.White);
            }
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0));
                vertices.Add(new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0));
                vertices.Add(new Vector3(-width * m12, width * m11, 0));
                vertices.Add(new Vector3(width * m12, -width * m11, 0));

                vertices.Add(new Vector3(length * m21 + width * m22, length * m22 - width * m21, 0));
                vertices.Add(new Vector3(length * m21 - width * m22, length * m22 + width * m21, 0));
                vertices.Add(new Vector3(-width * m22, width * m21, 0));
                vertices.Add(new Vector3(width * m22, -width * m21, 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                triangles.Add(count + 4);
                triangles.Add(count + 5);
                triangles.Add(count + 6);
                triangles.Add(count + 6);
                triangles.Add(count + 7);
                triangles.Add(count + 4);
                for (int i = 0; i < 8; i++) colors.Add(Color.White);
            }
            #endregion
        } else if (angle > 0) {
            #region 正常情况
            width += outline;
            length += outline;

            float circlex = -width / FloatMath.Sin(angle / 2f) * FloatMath.Cos(mid);
            float circley = -width / FloatMath.Sin(angle / 2f) * FloatMath.Sin(mid);

            {
                int count = 0;
                vertices.Add(new Vector3(circlex, circley, 0));
                vertices.Add(new Vector3(width * FloatMath.Sin(a[0]), -width * FloatMath.Cos(a[0]), 0));
                vertices.Add(Vector3.Zero);
                vertices.Add(new Vector3(-width * FloatMath.Sin(a[1]), width * FloatMath.Cos(a[1]), 0));
                triangles.Add(0);
                triangles.Add(1);
                triangles.Add(2);
                triangles.Add(2);
                triangles.Add(3);
                triangles.Add(count);
                for (int i = 0; i < 4; i++) colors.Add(Color.Black);
            }
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0));
                vertices.Add(new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0));
                vertices.Add(new Vector3(-width * m12, width * m11, 0));
                vertices.Add(new Vector3(width * m12, -width * m11, 0));

                vertices.Add(new Vector3(length * m21 + width * m22, length * m22 - width * m21, 0));
                vertices.Add(new Vector3(length * m21 - width * m22, length * m22 + width * m21, 0));
                vertices.Add(new Vector3(-width * m22, width * m21, 0));
                vertices.Add(new Vector3(width * m22, -width * m21, 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                triangles.Add(count + 4);
                triangles.Add(count + 5);
                triangles.Add(count + 6);
                triangles.Add(count + 6);
                triangles.Add(count + 7);
                triangles.Add(count + 4);
                for (int i = 0; i < 8; i++) colors.Add(Color.Black);
            }
            #endregion
            #region 边框
            width -= outline * 2f;
            length -= outline * 2f;

            circlex = -width / FloatMath.Sin(angle / 2f) * FloatMath.Cos(mid);
            circley = -width / FloatMath.Sin(angle / 2f) * FloatMath.Sin(mid);

            {
                int count = vertices.Count;
                vertices.Add(new Vector3(circlex, circley, 0));
                vertices.Add(new Vector3(width * FloatMath.Sin(a[0]), -width * FloatMath.Cos(a[0]), 0));
                vertices.Add(Vector3.Zero);
                vertices.Add(new Vector3(-width * FloatMath.Sin(a[1]), width * FloatMath.Cos(a[1]), 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                for (int i = 0; i < 4; i++) colors.Add(Color.White);
            }
            {
                int count = vertices.Count;
                vertices.Add(new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0));
                vertices.Add(new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0));
                vertices.Add(new Vector3(-width * m12, width * m11, 0));
                vertices.Add(new Vector3(width * m12, -width * m11, 0));

                vertices.Add(new Vector3(length * m21 + width * m22, length * m22 - width * m21, 0));
                vertices.Add(new Vector3(length * m21 - width * m22, length * m22 + width * m21, 0));
                vertices.Add(new Vector3(-width * m22, width * m21, 0));
                vertices.Add(new Vector3(width * m22, -width * m21, 0));
                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                triangles.Add(count + 4);
                triangles.Add(count + 5);
                triangles.Add(count + 6);
                triangles.Add(count + 6);
                triangles.Add(count + 7);
                triangles.Add(count + 4);
                for (int i = 0; i < 8; i++) colors.Add(Color.White);
            }
            #endregion
        } else {
            #region 如果角度差为180度，则绘制一个半圆（主体）
            length = width;
            width += outline;
            length += outline;

            Vector3 midpoint = new Vector3(-m11 * 0.04f, -m12 * 0.04f, 0);
            GraphicUtils.CreateCircle(midpoint, width, Color.Black, vertices, triangles, colors, 0);

            {
                int count = vertices.Count;
                vertices.Add(Vector3.Add(midpoint,new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m12, width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(width * m12, -width * m11, 0)));

                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                for (int i = 0; i < 4; i++) colors.Add(Color.Black);
            }
            #endregion
            #region 边框
            width -= outline * 2f;
            length -= outline * 2f;
            GraphicUtils.CreateCircle(midpoint, width, Color.White, vertices, triangles, colors, 0);
            {
                int count = vertices.Count;
                vertices.Add(Vector3.Add(midpoint,new Vector3(length * m11 + width * m12, length * m12 - width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(length * m11 - width * m12, length * m12 + width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m12, width * m11, 0)));
                vertices.Add(Vector3.Add(midpoint,new Vector3(width * m12, -width * m11, 0)));

                triangles.Add(count);
                triangles.Add(count + 1);
                triangles.Add(count + 2);
                triangles.Add(count + 2);
                triangles.Add(count + 3);
                triangles.Add(count);
                for (int i = 0; i < 4; i++) colors.Add(Color.White);
            }
            #endregion
        }
        
        Polygon polygon = new Polygon
        {
            vertices = vertices.ToArray(),
            triangles = triangles.Select(x => (short) x).ToArray(),
            colors = colors.ToArray()
        };
        return polygon;
    }
    
    private Polygon CreateMidspinPolygon(float a1) {

        float width = Floor.width;
        float length = Floor.width;
        float m1 = FloatMath.Cos(a1 / 180f * FloatMath.PI);
        float m2 = FloatMath.Sin(a1 / 180f * FloatMath.PI);

        #region 主体
        List<Vector3> vertices = [];
        List<int> triangles = [];
        List<Color> colors = [];
        Vector3 midpoint = new Vector3(-m1 * 0.04f, -m2 * 0.04f, 0);
        width += outline;
        length += outline;
        {
            int count = 0;
            vertices.Add(Vector3.Add(midpoint,new Vector3((length) * m1 + (width) * m2, (length) * m2 - (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3((length) * m1 - (width) * m2, (length) * m2 + (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-(width) * m2, (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3((width) * m2, -(width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m1, -width * m2, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(width * m2, -width * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m2, width * m1, 0)));
            triangles.Add(count);
            triangles.Add(count + 1);
            triangles.Add(count + 2);
            triangles.Add(count + 2);
            triangles.Add(count + 3);
            triangles.Add(count);
            triangles.Add(count + 4);
            triangles.Add(count + 5);
            triangles.Add(count + 6);
            for (int i = 0; i < 7; i++) colors.Add(Color.Black);
        }
        #endregion
        #region 边框
        width -= outline * 2;
        length -= outline * 2;
        {
            int count = vertices.Count;
            vertices.Add(Vector3.Add(midpoint,new Vector3((length) * m1 + (width) * m2, (length) * m2 - (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3((length) * m1 - (width) * m2, (length) * m2 + (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-(width) * m2, (width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3((width) * m2, -(width) * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m1, -width * m2, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(width * m2, -width * m1, 0)));
            vertices.Add(Vector3.Add(midpoint,new Vector3(-width * m2, width * m1, 0)));
            triangles.Add(count);
            triangles.Add(count + 1);
            triangles.Add(count + 2);
            triangles.Add(count + 2);
            triangles.Add(count + 3);
            triangles.Add(count);
            triangles.Add(count + 4);
            triangles.Add(count + 5);
            triangles.Add(count + 6);
            for (int i = 0; i < 7; i++) colors.Add(Color.White);
        }
        #endregion
     
        Polygon polygon = new Polygon
        {
            vertices = vertices.ToArray(),
            triangles = triangles.Select(x => (short) x).ToArray(),
            colors = colors.ToArray()
        };
        return polygon;
    }
    
    /// <summary>
    /// Polygon mesh structure containing vertex, triangle and color data
    /// 包含顶点、三角形和颜色数据的多边形网格结构
    /// </summary>
    public struct Polygon
    {
        /// <summary>
        /// Array of vertex positions (X, Y, Z) / 顶点位置数组（X, Y, Z）
        /// </summary>
        public Vector3[] vertices;
        
        /// <summary>
        /// Array of vertex colors (RGBA) / 顶点颜色数组（RGBA）
        /// </summary>
        public Color[] colors;
        
        /// <summary>
        /// Array of triangle indices (3 indices per triangle) / 三角形索引数组（每个三角形3个索引）
        /// </summary>
        public short[] triangles;

        /// <summary>
        /// Checks if the polygon is empty (no vertices, triangles or colors)
        /// 检查多边形是否为空（无顶点、三角形或颜色）
        /// </summary>
        /// <returns>True if empty, false otherwise / 如果为空返回true，否则返回false</returns>
        public bool IsEmpty()
        {
            if (vertices != null && triangles != null && colors != null)
            {
                return vertices.Length == 0 && triangles.Length == 0 && colors.Length == 0;
            }
            return true;
        }
    }

    /// <summary>
    /// Returns a string representation of the floor
    /// 返回地板的字符串表示形式
    /// </summary>
    public override string ToString()
    {
        return this.AsString();
    }
}